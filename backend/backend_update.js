const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// 1. Add imports
const newImports = `import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';`;
content = content.replace("import { v4 as uuidv4 } from 'uuid';", "import { v4 as uuidv4 } from 'uuid';\n" + newImports);

// 2. Add JWT secret and Seed Admin
const authLogic = `
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
`;
content = content.replace("const STORAGE_PATH = path.join(__dirname, '../storage');", authLogic + "\nconst STORAGE_PATH = path.join(__dirname, '../storage');");

// 3. Update TokenAuthenticator to verify JWT
const newAuthenticator = `class TokenAuthenticator implements webdav.HTTPAuthentication {
  askForAuthentication(ctx: webdav.HTTPRequestContext): { [headerName: string]: string } {
    return {
      'WWW-Authenticate': 'Basic realm="DocsGraph Replica"'
    };
  }
  
  getUser(ctx: webdav.HTTPRequestContext, callback: (error: Error, user?: webdav.IUser) => void): void {
    const req = ctx.request as any;
    const url = req.originalUrl || req.url || '';
    
    // Check if there is a TOKEN_ in the URL
    const tokenMatch = url.match(/\\/TOKEN_([^\\/]+)/);
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
}`;
content = content.replace(/class TokenAuthenticator[\s\S]*?\}\n\}/, newAuthenticator);

// 4. Add Auth Middleware and Login/User APIs
const authMiddleware = `
// --- Authentication Middleware ---
const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
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
    const result = await g.V().hasLabel('User').valueMap('username', 'role', 'created_at').toList();
    const users = result.map((v, i) => {
      const map = v as Map<string, any[]>;
      return {
        id: (await g.V().hasLabel('User').toList())[i].id,
        username: map.get('username')?.[0],
        role: map.get('role')?.[0],
        created_at: map.get('created_at')?.[0]
      };
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authenticateToken, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const existing = await g.V().hasLabel('User').has('username', username).count().next();
    if (existing.value > 0) return res.status(400).json({ error: 'Username already exists' });
    
    const hash = await bcrypt.hash(password, 10);
    const vertex = await g.addV('User')
      .property('username', username)
      .property('password_hash', hash)
      .property('role', role || 'user')
      .property('created_at', new Date().toISOString())
      .next();
      
    res.json({ id: vertex.value.id, username, role });
  } catch (error) {
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

`;
content = content.replace("// --- API Routes ---", "// --- API Routes ---\n" + authMiddleware);

fs.writeFileSync('src/index.ts', content);
console.log("Updated src/index.ts");
