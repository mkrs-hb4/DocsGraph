const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

// Fix GET /api/users
content = content.replace(
  "const result = await g.V().hasLabel('User').valueMap('username', 'role', 'created_at').toList();",
  "const result = await g.V().hasLabel('User').valueMap(true).toList();"
);

content = content.replace(
  /const users = result\.map\(\(v, i\) => \{\s*const map = v as Map<string, any\[\]>;\s*return \{\s*id: \(await g\.V\(\)\.hasLabel\('User'\)\.toList\(\)\)\[i\]\.id,/m,
  \`const users = result.map((v) => {
      const map = v as Map<any, any>;
      return {
        id: map.get(gremlin.process.t.id),\`
);

// Fix TS2345 line 274: Argument of type 'Traverser' is not assignable to parameter of type 'string'.
// This refers to dropping vertices. g.V(id).drop().next()
// The id should be passed as string. Wait, where is line 274? Let's check.
