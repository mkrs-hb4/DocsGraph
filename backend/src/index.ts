import express from 'express';
import cors from 'cors';
import { v2 as webdav } from 'webdav-server';
import gremlin from 'gremlin';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Client } from '@opensearch-project/opensearch';
import officeParser from 'officeparser';

const app = express();
app.use(cors());
app.use(express.json());

// --- OpenSearch Setup ---
const opensearchUrl = process.env.OPENSEARCH_URL || 'http://localhost:9200';
const osClient = new Client({ node: opensearchUrl });

async function setupOpenSearch() {
  try {
    const { body: exists } = await osClient.indices.exists({ index: 'documents' });
    if (!exists) {
      await osClient.indices.create({ index: 'documents' });
      console.log('OpenSearch index "documents" created.');
    } else {
      console.log('OpenSearch index "documents" already exists.');
    }
  } catch (error) {
    console.error('Error setting up OpenSearch:', error);
  }
}
setupOpenSearch();

// --- Gremlin (Neptune) Setup ---
const Traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const __ = gremlin.process.statics;

// In production, this would be the Neptune cluster endpoint
const gremlinUrl = process.env.GREMLIN_URL || 'ws://localhost:8182/gremlin';
const g = Traversal().withRemote(new DriverRemoteConnection(gremlinUrl));

// --- Storage Setup ---
// In production (AWS ECS Fargate), we will mount an S3 bucket using "Mountpoint for Amazon S3"
// or an EFS volume to this path. Locally, it's just a folder.

const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret';

// Seed initial admin user if no users exist
async function seedAdmin() {
  try {
    const userCount = await g.V().hasLabel('User').count().next();
    if (userCount.value === 0) {
      const hash = await bcrypt.hash('admin', 10);
      await g.addV('User')
        .property('username', 'admin')
        .property('password_hash', hash)
        .property('role', 'admin')
        .property('created_at', new Date().toISOString())
        .next();
      console.log('Seeded initial admin user (admin/admin)');
    }
  } catch (err) {
    console.error('Failed to seed admin:', err);
  }
}
seedAdmin();

const STORAGE_PATH = path.join(__dirname, '../storage');
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}



// Implement Token-based Authentication for WebDAV
class TokenAuthenticator implements webdav.HTTPAuthentication {
  askForAuthentication(ctx: webdav.HTTPRequestContext): { [headerName: string]: string } {
    return {
      'WWW-Authenticate': 'Basic realm="DocsGraph Replica"'
    };
  }

  getUser(ctx: webdav.HTTPRequestContext, callback: (error: Error, user?: webdav.IUser) => void): void {
    const req = ctx.request as any;
    const url = req.originalUrl || req.url || '';

    // Check if there is a TOKEN_ in the URL
    const tokenMatch = url.match(/\/TOKEN_([^\/]+)/);
    if (tokenMatch) {
      const token = tokenMatch[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return callback(null as unknown as Error, { uid: decoded.username } as webdav.IUser);
      } catch (err) {
        return callback(new Error('Invalid token'));
      }
    }

    // Check Authorization header for Bearer token
    const authHeader = ctx.request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return callback(null as unknown as Error, { uid: decoded.username } as webdav.IUser);
      } catch (err) {
        return callback(new Error('Invalid token'));
      }
    }

    callback(new Error('Unauthorized'));
  }
}

// --- WebDAV Setup ---
const webdavServer = new webdav.WebDAVServer({
  port: 3001,
  httpAuthentication: new TokenAuthenticator()
});

// Configure WebDAV to use the physical file system
webdavServer.setFileSystem('/', new webdav.PhysicalFileSystem(STORAGE_PATH), (success) => {
  if (success) {
    console.log('WebDAV FileSystem mounted to ' + STORAGE_PATH);
  }
});

// Hook into WebDAV afterRequest to index files on upload/save
webdavServer.afterRequest(async (arg, next) => {
  if (arg.request.method === 'PUT' && arg.response.statusCode >= 200 && arg.response.statusCode < 300) {
    const rawUrl = arg.request.url || '';

    // Extract token to identify user
    const tokenMatch = rawUrl.match(/\/TOKEN_([^\/]+)/);
    let username = 'anonymous';
    if (tokenMatch) {
      try {
        const decoded = jwt.verify(tokenMatch[1], JWT_SECRET) as any;
        username = decoded.username;
      } catch (err) { }
    }

    // Strip WebDAV base path and token if present to get the actual filename
    const filename = rawUrl.replace(/^\/webdav(\/TOKEN_[^\/]+)?\//, '').replace(/^\//, '');

    if (filename && !filename.startsWith('.')) {
      const physicalPath = path.join(STORAGE_PATH, filename);
      console.log(`WebDAV PUT detected for ${filename}. Indexing in OpenSearch...`);

      // Track EDITED action in Gremlin
      try {
        const users = await g.V().hasLabel('User').has('username', username).toList();
        const datasets = await g.V().hasLabel('Dataset').has('storage_id', filename).toList();

        if (users.length > 0 && datasets.length > 0) {
          const userVertexId = (users[0] as any).id;
          const datasetVertexId = (datasets[0] as any).id;
          await g.V(userVertexId).addE('EDITED').to(g.V(datasetVertexId)).property('timestamp', new Date().toISOString()).next();
          console.log(`Tracked EDITED action by ${username} on ${filename}`);
        }
      } catch (err) {
        console.error(`Failed to track EDITED action in Gremlin:`, err);
      }
      try {
        if (fs.existsSync(physicalPath)) {
          // Extract text from Office/PDF or read plain text
          const rawContent = await officeParser.parseOffice(physicalPath);
          const content = (typeof rawContent === 'object' && typeof rawContent.toText === 'function')
            ? rawContent.toText()
            : typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

          await osClient.index({
            index: 'documents',
            id: filename, // Use filename (storage_id) as the OpenSearch ID
            body: {
              filename: filename,
              content: content,
              timestamp: new Date().toISOString()
            }
          });
          console.log(`Successfully indexed ${filename} into OpenSearch.`);
        }
      } catch (err) {
        console.error(`Failed to index ${filename} in OpenSearch:`, err);
      }
    }
  }
  next();
});

// Middleware to strip TOKEN_xxx from WebDAV URLs so it reads from the correct storage root
app.use('/webdav', (req, res, next) => {
  if (req.url.startsWith('/TOKEN_')) {
    req.url = req.url.replace(/^\/TOKEN_[^\/]+/, '');
  }
  next();
});

app.use(webdav.extensions.express('/webdav', webdavServer));


// --- API Routes ---

// --- Authentication Middleware ---
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    (req as any).user = user;
    next();
  });
};

// --- Auth & User APIs ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = await g.V().hasLabel('User').has('username', username).valueMap('username', 'password_hash', 'role').toList();
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const map = users[0] as Map<string, any[]>;
    const hash = map.get('password_hash')?.[0];

    const match = await bcrypt.compare(password, hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const role = map.get('role')?.[0];
    const token = jwt.sign({ username, role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username, role });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await g.V().hasLabel('User')
      .project('user', 'group')
      .by(__.valueMap(true))
      .by(__.coalesce(__.out('belongs_to').values('name'), __.constant('')))
      .toList();

    const users = result.map(item => {
      const itemMap = item as Map<any, any>;
      const map = itemMap.get('user') as Map<any, any>;
      return {
        id: map.get(gremlin.process.t.id),
        username: map.get('username')?.[0],
        fullName: map.get('fullName')?.[0] || map.get('username')?.[0], // Fallback to username
        role: map.get('role')?.[0],
        created_at: map.get('created_at')?.[0],
        group: itemMap.get('group')
      };
    });
    res.json(users);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authenticateToken, async (req, res) => {
  const { username, password, fullName, group, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const existing = await g.V().hasLabel('User').has('username', username).count().next();
    if (existing.value > 0) return res.status(400).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(password, 10);
    const userVertex = await g.addV('User')
      .property('username', username)
      .property('password_hash', hash)
      .property('fullName', fullName || username)
      .property('role', role || 'user')
      .property('created_at', new Date().toISOString())
      .next();

    if (group) {
      // Find or create group
      const existingGroup = await g.V().hasLabel('Group').has('name', group).toList();
      let groupVertex;
      if (existingGroup.length > 0) {
        groupVertex = existingGroup[0];
      } else {
        const newGroup = await g.addV('Group').property('name', group).next();
        groupVertex = newGroup.value;
      }

      // Create edge User -> belongs_to -> Group
      await g.V(userVertex.value.id).addE('belongs_to').to(__.V(groupVertex.id)).next();
    }

    res.json({ id: userVertex.value.id, username, fullName, group, role });
  } catch (error) {
    console.error('Failed to create user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    await g.V(req.params.id).drop().next();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Protect all other routes with authenticateToken (except healthcheck and login)
app.use('/api/files', authenticateToken);
app.use('/api/events', authenticateToken);



// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', storage: STORAGE_PATH, gremlin: gremlinUrl });
});

// 1. Get all datasets (from Gremlin)
app.get('/api/files', async (req, res) => {
  const query = req.query.q as string;
  try {
    let storageIdsFilter: string[] | null = null;
    let highlightsMap: Record<string, string> = {};

    // 1. If there's a search query, ask OpenSearch first
    if (query) {
      try {
        const osRes = await osClient.search({
          index: 'documents',
          body: {
            query: {
              multi_match: {
                query: query,
                fields: ['content', 'filename'],
                type: 'phrase_prefix'
              }
            },
            highlight: {
              fields: {
                content: {}
              }
            }
          }
        });
        const hits = osRes.body.hits.hits;
        storageIdsFilter = hits.map((hit: any) => hit._id);

        hits.forEach((hit: any) => {
          if (hit.highlight && hit.highlight.content) {
            highlightsMap[hit._id] = hit.highlight.content[0];
          }
        });
      } catch (err) {
        console.error('OpenSearch query failed (index might be empty or missing):', err);
        storageIdsFilter = [];
      }
    }

    // 2. Query Neptune for graph metadata
    let traversal = g.V().hasLabel('Dataset');

    if (query) {
      if (storageIdsFilter && storageIdsFilter.length > 0) {
        // Hybrid: Match OpenSearch IDs OR match original_name in Graph
        traversal = traversal.or(
          __.has('storage_id', gremlin.process.P.within(storageIdsFilter)),
          __.has('original_name', gremlin.process.TextP.containing(query))
        );
      } else {
        // No OpenSearch hits, fallback entirely to graph search
        traversal = traversal.has('original_name', gremlin.process.TextP.containing(query));
      }
    }

    const result = await traversal.valueMap(true).toList();

    const files = result.map(v => {
      const map = v as Map<any, any>;
      const obj: any = {};
      obj.id = map.get(gremlin.process.t.id);
      for (const [key, value] of map.entries()) {
        if (key !== gremlin.process.t.id && key !== gremlin.process.t.label) {
          obj[key] = Array.isArray(value) ? value[0] : value;
        }
      }

      if (obj.storage_id && highlightsMap[obj.storage_id]) {
        obj.highlight = highlightsMap[obj.storage_id];
      }

      return obj;
    });

    res.json(files);
  } catch (error) {
    console.error('Gremlin query failed:', error);
    res.status(500).json({ error: 'Failed to fetch datasets' });
  }
});

// Create Dataset Metadata in Gremlin
app.post('/api/files', authenticateToken, async (req, res) => {
  const { original_name, storage_id, description, tags, size } = req.body;
  const username = (req as any).user.username;

  if (!original_name) return res.status(400).json({ error: 'Missing original_name' });
  if (!storage_id) return res.status(400).json({ error: 'Missing storage_id' });

  try {
    const users = await g.V().hasLabel('User').has('username', username).toList();
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    const userVertexId = (users[0] as any).id;

    const vertex = await g.addV('Dataset')
      .property('original_name', original_name)
      .property('storage_id', storage_id)
      .property('description', description || '')
      .property('tags', tags || '')
      .property('size', size || 0)
      .property('created_at', new Date().toISOString())
      .next();

    const generatedId = vertex.value.id;

    // Create UPLOADED edge
    await g.V(userVertexId).addE('UPLOADED').to(g.V(generatedId)).property('timestamp', new Date().toISOString()).next();

    res.json({ id: generatedId, original_name, success: true });
  } catch (error) {
    console.error('Failed to create dataset in Gremlin:', error);
    res.status(500).json({ error: 'Failed to create dataset metadata' });
  }
});


// Delete Dataset Metadata in Gremlin and file in storage
app.delete('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get file name to delete from physical storage
    const result = await g.V(id).values('storage_id').toList();
    if (result.length > 0) {
      const fileName = result[0] as string;
      const filePath = path.join(STORAGE_PATH, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else {
      // Fallback for older files
      const oldResult = await g.V(id).values('original_name').toList();
      if (oldResult.length > 0) {
        const fileName = oldResult[0] as string;
        const filePath = path.join(STORAGE_PATH, fileName);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Drop from graph
    await g.V(id).drop().next();

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete dataset:', error);
    res.status(500).json({ error: 'Failed to delete dataset' });
  }
});

// Download/View file with original filename
app.get('/api/files/:id/download', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await g.V(id).valueMap('original_name', 'storage_id').toList();
    if (result.length === 0) return res.status(404).json({ error: 'File not found' });

    const map = result[0] as Map<string, any[]>;
    const originalName = map.get('original_name')?.[0];
    const storageId = map.get('storage_id')?.[0] || originalName; // fallback to original if no storage_id

    const filePath = path.join(STORAGE_PATH, storageId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Physical file not found' });
    }

    // Set header so browser knows the original file name when saving
    // encodeURIComponent handles Japanese characters in filenames
    const encodedName = encodeURIComponent(originalName);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedName}`);

    res.sendFile(filePath);
  } catch (error) {
    console.error('Failed to download file:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// 2. Track user action (VIEWED, DOWNLOADED, OPENED_LOCAL)
app.post('/api/files/:id/action', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { action_type } = req.body;
  const username = (req as any).user.username;

  if (!action_type || !['VIEWED', 'DOWNLOADED', 'OPENED_LOCAL', 'EDITED'].includes(action_type)) {
    return res.status(400).json({ error: 'Invalid action_type' });
  }

  try {
    const users = await g.V().hasLabel('User').has('username', username).toList();
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    const userVertexId = (users[0] as any).id;

    await g.V(userVertexId).addE(action_type).to(g.V(id)).property('timestamp', new Date().toISOString()).next();

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to log action:', error);
    res.status(500).json({ error: 'Failed to log action' });
  }
});

// 3. Hybrid Recommendations
app.get('/api/files/:id/recommendations', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Step 1: Get target dataset tags
    const targetFile = await g.V(id).valueMap('tags').toList();
    if (targetFile.length === 0) return res.status(404).json({ error: 'File not found' });

    const targetTagsStr = (targetFile[0] as Map<any, any>).get('tags')?.[0] || '';
    const targetTags = targetTagsStr.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);

    // Step 2: Get all datasets to fallback/score
    const allDatasetsRes = await g.V().hasLabel('Dataset').where(__.hasId(gremlin.process.P.neq(id))).valueMap(true).toList();
    const allDatasets = allDatasetsRes.map(v => {
      const map = v as Map<any, any>;
      const obj: any = { id: map.get(gremlin.process.t.id) };
      for (const [key, value] of map.entries()) {
        if (key !== gremlin.process.t.id && key !== gremlin.process.t.label) {
          obj[key] = Array.isArray(value) ? value[0] : value;
        }
      }
      return obj;
    });

    // Step 3: Get related items via CF (same user actions)
    const interactions = await g.V(id)
      .inE('VIEWED', 'DOWNLOADED', 'OPENED_LOCAL', 'UPLOADED', 'EDITED')
      .outV() // Users
      .outE('VIEWED', 'DOWNLOADED', 'OPENED_LOCAL', 'UPLOADED', 'EDITED')
      .where(__.inV().hasId(gremlin.process.P.neq(id))) // Other datasets
      .project('datasetId', 'action', 'timestamp')
      .by(__.inV().id())
      .by(__.label())
      .by(__.values('timestamp'))
      .toList();

    const actionWeights: Record<string, number> = {
      'EDITED': 6,
      'OPENED_LOCAL': 5,
      'DOWNLOADED': 3,
      'UPLOADED': 2,
      'VIEWED': 1
    };

    const scores: Record<string, number> = {};
    const now = new Date().getTime();

    // Calculate CF Score with time decay
    interactions.forEach(item => {
      const map = item as Map<string, any>;
      const datasetId = map.get('datasetId');
      const action = map.get('action');
      const timestamp = new Date(map.get('timestamp')).getTime();

      const hoursDiff = (now - timestamp) / (1000 * 60 * 60);
      let timeMultiplier = 0.1;
      if (hoursDiff <= 24) timeMultiplier = 1.0;

      const baseWeight = actionWeights[action] || 1;
      const scoreAdd = baseWeight * timeMultiplier;

      scores[datasetId] = (scores[datasetId] || 0) + scoreAdd;
    });

    // Calculate Tag Similarity Score
    allDatasets.forEach(ds => {
      const dsTagsStr = ds.tags || '';
      const dsTags = dsTagsStr.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);

      let commonTags = 0;
      targetTags.forEach((t: string) => {
        if (dsTags.includes(t)) commonTags++;
      });

      const tagScore = commonTags * 2;
      scores[ds.id] = (scores[ds.id] || 0) + tagScore;
    });

    allDatasets.sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
    const recommendations = allDatasets.filter(ds => scores[ds.id] > 0).slice(0, 5);

    res.json(recommendations);
  } catch (error) {
    console.error('Failed to get recommendations:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend Server running on port ${PORT}`);
  console.log(`WebDAV Endpoint: http://localhost:${PORT}/webdav`);
});
