const fs = require('fs');

const appTsx = `import { useState, useEffect, useRef } from 'react';
import { Database, Upload, X, Search, FileText, Download, LayoutDashboard, Share2, Shield, MoreHorizontal, Trash2, LogOut, Users } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import './index.css';

const API_BASE = 'http://localhost:3001/api';

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  
  // Login State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Main State
  const [files, setFiles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('catalog');
  
  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // User Management State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  // Dropdown State
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const getHeaders = () => ({
    'Authorization': \`Bearer \${token}\`,
    'Content-Type': 'application/json'
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(\`\${API_BASE}/login\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        localStorage.setItem('token', data.token);
        setLoginError('');
      } else {
        setLoginError('Invalid username or password');
      }
    } catch (e) {
      setLoginError('Login failed');
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('token');
  };

  const fetchFiles = async (query = '') => {
    try {
      const res = await fetch(\`\${API_BASE}/files?q=\${encodeURIComponent(query)}\`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }
    } catch (error) {
      console.error('Failed to fetch files:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(\`\${API_BASE}/users\`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  useEffect(() => {
    if (token) {
      if (view === 'catalog') fetchFiles();
      if (view === 'users') fetchUsers();
    }
  }, [view, token]);

  const handleUploadSubmit = async () => {
    if (!fileToUpload) return;

    const fileExt = fileToUpload.name.split('.').pop() || '';
    const storageId = \`\${uuidv7()}\${fileExt ? \`.\${fileExt}\` : ''}\`;
    
    // Pass real token to WebDAV bypass via URL
    const url = \`\${API_BASE.replace('/api', '/webdav')}/TOKEN_\${token}/\${storageId}\`;
    
    try {
      await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': fileToUpload.type
        },
        body: fileToUpload,
      });

      await fetch(\`\${API_BASE}/files\`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          original_name: fileToUpload.name,
          storage_id: storageId,
          description: description,
          tags: tags,
          size: fileToUpload.size
        }),
      });
      
      setFileToUpload(null);
      setDescription('');
      setTags('');
      setIsUploadModalOpen(false);
      fetchFiles(searchQuery);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('本当に削除しますか？')) return;
    try {
      await fetch(\`\${API_BASE}/files/\${id}\`, { method: 'DELETE', headers: getHeaders() });
      setOpenDropdownId(null);
      fetchFiles(searchQuery);
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(\`\${API_BASE}/users\`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ username: newUsername, password: newPassword, role: 'user' })
      });
      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        fetchUsers();
      } else {
        alert('Failed to create user');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('ユーザーを削除しますか？')) return;
    try {
      await fetch(\`\${API_BASE}/users/\${id}\`, { method: 'DELETE', headers: getHeaders() });
      fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    fetchFiles(val);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h2>DocsGraph</h2>
          <p>Please log in to continue</p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {loginError && <p className="text-danger" style={{marginTop: '0'}}>{loginError}</p>}
            <button type="submit" className="btn btn-primary" style={{width: '100%'}}>Log In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <Database size={24} color="var(--primary)" />
          <h3>DocsGraph</h3>
        </div>
        <ul className="sidebar-nav">
          <li className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}>
            <Database size={18} />
            Documents
          </li>
          <li className={view === 'dashboards' ? 'active' : ''} onClick={() => setView('dashboards')}>
            <LayoutDashboard size={18} />
            Dashboards
          </li>
          <li className={view === 'lineage' ? 'active' : ''} onClick={() => setView('lineage')}>
            <Share2 size={18} />
            Lineage
          </li>
          <li className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}>
            <Users size={18} />
            Users
          </li>
          <li className={view === 'governance' ? 'active' : ''} onClick={() => setView('governance')}>
            <Shield size={18} />
            Governance
          </li>
        </ul>
      </div>

      <div className="layout-content">
        <header className="header" style={{ justifyContent: 'space-between', display: 'flex' }}>
          <div className="header-search"></div>
          <div className="header-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button className="btn" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </header>

        <main className="main-content">
          {view === 'catalog' && (
            <>
              <div className="search-bar">
                <Search size={22} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  placeholder="Search docs, files, tags..."
                  value={searchQuery}
                  onChange={handleSearch}
                />
              </div>

              <div className="section-header">
                <h2>Documents</h2>
                <button className="btn btn-primary" onClick={() => setIsUploadModalOpen(true)}>
                  <Upload size={16} />
                  New Document
                </button>
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Tags</th>
                      <th>Size</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.length === 0 ? (
                      <tr><td colSpan={5} style={{textAlign: 'center', padding: '2rem'}}>No Docs found</td></tr>
                    ) : (
                      files.map(file => (
                        <tr key={file.id}>
                          <td style={{ position: 'relative' }}>
                            <a 
                              href={\`\${API_BASE}/files/\${file.id}/download?token=\${token}\`} 
                              target="_blank" 
                              rel="noreferrer"
                              className="entity-name"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                              <FileText size={18} />
                              {file.original_name}
                            </a>
                          </td>
                          <td style={{ color: 'var(--text-muted)' }}>{file.description || '-'}</td>
                          <td>
                            {file.tags ? file.tags.split(',').map((tag: string) => (
                              <span key={tag.trim()} className="tag">{tag.trim()}</span>
                            )) : '-'}
                          </td>
                          <td>{formatSize(file.size)}</td>
                          <td style={{ position: 'relative' }}>
                            <button 
                              className="btn-icon" 
                              onClick={() => setOpenDropdownId(openDropdownId === file.id ? null : file.id)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', verticalAlign: 'middle' }}
                            >
                              <MoreHorizontal size={18} color="var(--text-muted)" />
                            </button>

                            {openDropdownId === file.id && (
                              <div className="dropdown-menu">
                                <button className="dropdown-item text-danger" onClick={() => handleDelete(file.id)}>
                                  <Trash2 size={14} />
                                  削除する
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {view === 'users' && (
            <>
              <div className="section-header">
                <h2>User Management</h2>
              </div>
              
              <div className="card" style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <h3>Add New User</h3>
                <form onSubmit={handleCreateUser} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginTop: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                    <label>Username</label>
                    <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                    <label>Password</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                  </div>
                  <button type="submit" className="btn btn-primary">Add User</button>
                </form>
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Created At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td>{u.role}</td>
                        <td>{new Date(u.created_at).toLocaleString()}</td>
                        <td>
                          {u.username !== 'admin' && (
                            <button className="btn btn-icon" onClick={() => handleDeleteUser(u.id)}>
                              <Trash2 size={16} color="var(--danger, #ff4d4f)" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {view !== 'catalog' && view !== 'users' && (
            <div className="section-header">
              <h2>{view.charAt(0).toUpperCase() + view.slice(1)}</h2>
              <p>Coming soon...</p>
            </div>
          )}
        </main>
      </div>

      {isUploadModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Upload Document</h2>
              <button className="btn-icon" onClick={() => setIsUploadModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>File</label>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={(e) => setFileToUpload(e.target.files ? e.target.files[0] : null)}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter Document description"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Tags (comma separated)</label>
                <input 
                  type="text" 
                  value={tags} 
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. Sales, 2024, Raw"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setIsUploadModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUploadSubmit} disabled={!fileToUpload}>
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`;

fs.writeFileSync('src/App.tsx', appTsx);
console.log("Updated App.tsx");
