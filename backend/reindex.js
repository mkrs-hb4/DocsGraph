const fs = require('fs');
const path = require('path');
const { Client } = require('@opensearch-project/opensearch');
const officeParser = require('officeparser');

const osClient = new Client({ node: 'http://localhost:9200' });
const storagePath = path.join(__dirname, 'storage');

async function run() {
  const files = fs.readdirSync(storagePath);
  for (const filename of files) {
    if (filename.startsWith('.')) continue;
    const physicalPath = path.join(storagePath, filename);
    try {
      const rawContent = await officeParser.parseOffice(physicalPath);
      const content = (typeof rawContent === 'object' && typeof rawContent.toText === 'function') 
            ? rawContent.toText() 
            : typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
            
      await osClient.index({
        index: 'documents',
        id: filename,
        body: {
          filename,
          content,
          timestamp: new Date().toISOString()
        }
      });
      console.log('Indexed', filename);
    } catch(e) {
      console.log('Skipped', filename, e.message);
    }
  }
}
run().catch(console.error);
