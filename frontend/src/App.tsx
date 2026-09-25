import { useState, useEffect } from 'react';
import { Database, Upload, X, Search, FileText, LayoutDashboard, Share2, Shield, MoreHorizontal, Trash2, LogOut, Users, ExternalLink } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import './index.css';

const API_BASE = `http://${window.location.hostname}:3001/api`;

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));

  // Login State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Main State
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('catalog');

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);

  // Add User Modal State
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newFullName, setNewFullName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');

  // User Management State
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Dropdown State
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const getHeaders = () => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/login`, {
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
      const res = await fetch(`${API_BASE}/files?q=${encodeURIComponent(query)}`, { headers: getHeaders() });
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
      const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const trackAction = async (fileId: string, actionType: string) => {
    try {
      await fetch(`${API_BASE}/files/${fileId}/action`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ action_type: actionType })
      });
    } catch (e) {
      console.error('Failed to track action', e);
    }
  };

  useEffect(() => {
    if (token) {
      if (view === 'catalog') fetchFiles();
      if (view === 'users') fetchUsers();
    }
  }, [view, token]);

  useEffect(() => {
    if (selectedFileIds.length === 1) {
      const fileId = selectedFileIds[0];
      trackAction(fileId, 'VIEWED');

      fetch(`${API_BASE}/files/${fileId}/recommendations`, { headers: getHeaders() })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setRecommendations(data);
          }
        })
        .catch(e => console.error(e));
    } else {
      setRecommendations([]);
    }
  }, [selectedFileIds, token]);

  const handleUploadSubmit = async () => {
    if (!fileToUpload) return;

    const fileExt = fileToUpload.name.split('.').pop() || '';
    const storageId = `${uuidv7()}${fileExt ? `.${fileExt}` : ''}`;

    // Pass real token to WebDAV bypass via URL
    const url = `${API_BASE.replace('/api', '/webdav')}/TOKEN_${token}/${storageId}`;

    try {
      await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': fileToUpload.type
        },
        body: fileToUpload,
      });

      await fetch(`${API_BASE}/files`, {
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
      await fetch(`${API_BASE}/files/${id}`, { method: 'DELETE', headers: getHeaders() });
      setOpenDropdownId(null);
      fetchFiles(searchQuery);
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ username: newUsername, password: newPassword, fullName: newFullName, group: newGroup, role: 'user' })
      });
      if (res.ok) {
        setNewUsername('');
        setNewPassword('');
        setNewFullName('');
        setNewGroup('');
        setIsAddUserModalOpen(false);
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
      await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE', headers: getHeaders() });
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
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getOfficeLocalOpenUrl = (file: any, token: string | null) => {
    if (!file || !file.original_name || !token) return null;
    const ext = file.original_name.split('.').pop()?.toLowerCase();
    const webdavUrl = `${API_BASE.replace('/api', '')}/webdav/TOKEN_${token}/${file.storage_id}`;

    if (['doc', 'docx'].includes(ext)) {
      return `ms-word:ofe|u|${webdavUrl}`;
    } else if (['xls', 'xlsx'].includes(ext)) {
      return `ms-excel:ofe|u|${webdavUrl}`;
    } else if (['ppt', 'pptx'].includes(ext)) {
      return `ms-powerpoint:ofe|u|${webdavUrl}`;
    }
    return null;
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
            {loginError && <p className="text-danger" style={{ marginTop: '0' }}>{loginError}</p>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Log In</button>
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
                  placeholder="Search Docs, files, tags..."
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

              <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: '40px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={files.length > 0 && selectedFileIds.length === files.length}
                              onChange={(e) => setSelectedFileIds(e.target.checked ? files.map(f => f.id) : [])}
                            />
                          </th>
                          <th>Name</th>
                          <th>Description</th>
                          <th>Tags</th>
                          <th>Size</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {files.length === 0 ? (
                          <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No Docs found</td></tr>
                        ) : (
                          files.map(file => (
                            <tr key={file.id}>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedFileIds.includes(file.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedFileIds([...selectedFileIds, file.id]);
                                    else setSelectedFileIds(selectedFileIds.filter(id => id !== file.id));
                                  }}
                                />
                              </td>
                              <td style={{ position: 'relative' }}>
                                <a
                                  href={`${API_BASE}/files/${file.id}/download?token=${token}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="entity-name"
                                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                  onClick={() => trackAction(file.id, 'DOWNLOADED')}
                                >
                                  <FileText size={18} style={{ marginRight: '8px' }} />
                                  {file.original_name}
                                </a>
                                {file.highlight && (
                                  <div
                                    style={{
                                      fontSize: '0.85rem',
                                      color: 'var(--text-secondary)',
                                      marginTop: '6px',
                                      backgroundColor: 'rgba(59, 130, 246, 0.05)',
                                      padding: '6px 8px',
                                      borderRadius: '4px',
                                      borderLeft: '3px solid var(--primary)',
                                      wordBreak: 'break-all'
                                    }}
                                  >
                                    ...
                                    {file.highlight.split(/(<em>|<\/em>)/g).map((part: string, i: number) => {
                                      if (part === '<em>' || part === '</em>') return null;
                                      // If the previous part was <em>, this part should be highlighted
                                      const isHighlighted = i > 0 && file.highlight.split(/(<em>|<\/em>)/g)[i - 1] === '<em>';
                                      return isHighlighted ? (
                                        <span key={i} style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{part}</span>
                                      ) : (
                                        <span key={i}>{part.replace(/<[^>]*>?/gm, '') /* strip any other literal tags just in case */}</span>
                                      );
                                    })}
                                    ...
                                  </div>
                                )}
                              </td>
                              <td style={{ color: 'var(--text-muted)' }}>{file.description || '-'}</td>
                              <td>
                                {file.tags ? file.tags.split(',').map((tag: string) => (
                                  <span key={tag.trim()} className="tag">{tag.trim()}</span>
                                )) : '-'}
                              </td>
                              <td>{formatSize(file.size)}</td>
                              <td style={{ position: 'relative', zIndex: openDropdownId === file.id ? 10 : 1 }}>
                                <button
                                  className="btn-icon"
                                  onClick={() => setOpenDropdownId(openDropdownId === file.id ? null : file.id)}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', verticalAlign: 'middle' }}
                                >
                                  <MoreHorizontal size={18} color="var(--text-muted)" />
                                </button>

                                {openDropdownId === file.id && (
                                  <div className="dropdown-menu">
                                    {getOfficeLocalOpenUrl(file, token) && (
                                      <a
                                        className="dropdown-item"
                                        href={getOfficeLocalOpenUrl(file, token)!}
                                        style={{ color: 'inherit', textDecoration: 'none' }}
                                        onClick={() => {
                                          setOpenDropdownId(null);
                                          trackAction(file.id, 'OPENED_LOCAL');
                                        }}
                                      >
                                        <ExternalLink size={14} />
                                        ローカルアプリで開く
                                      </a>
                                    )}
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
                </div>

                <div className="attributes-panel" style={{ width: '300px', backgroundColor: 'var(--surface)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border)', flexShrink: 0 }}>
                  <h3 style={{ marginBottom: '16px', fontSize: '1.1rem', color: 'var(--text-main)', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                    Properties
                  </h3>
                  {selectedFileIds.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: '40px' }}>
                      Select a file to view its properties
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {files.filter(f => selectedFileIds.includes(f.id)).map(file => (
                        <div key={file.id} style={{ backgroundColor: 'var(--background)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 'bold', wordBreak: 'break-all', marginBottom: '8px', color: 'var(--primary)' }}>
                            {file.original_name}
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div><strong>ID:</strong> {file.id}</div>
                            <div><strong>Storage ID:</strong> <span style={{ wordBreak: 'break-all' }}>{file.storage_id}</span></div>
                            <div><strong>Size:</strong> {formatSize(file.size)}</div>
                            <div><strong>Description:</strong> {file.description || '-'}</div>
                            <div>
                              <strong>Tags:</strong>{' '}
                              {file.tags ? file.tags.split(',').map((tag: string) => (
                                <span key={tag.trim()} style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', marginRight: '4px', display: 'inline-block', marginTop: '2px' }}>{tag.trim()}</span>
                              )) : '-'}
                            </div>
                            <div><strong>Created:</strong> {new Date(file.created_at).toLocaleString()}</div>
                          </div>

                          {selectedFileIds.length === 1 && recommendations.length > 0 && (
                            <div style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: 'var(--text-main)' }}>関連ファイル</h4>
                              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {recommendations.map(rec => (
                                  <li key={rec.id}>
                                    <a
                                      href={`${API_BASE}/files/${rec.id}/download?token=${token}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                                      onClick={() => trackAction(rec.id, 'DOWNLOADED')}
                                    >
                                      <FileText size={14} />
                                      {rec.original_name}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {view === 'users' && (
            <>
              <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>User Management</h2>
                <button className="btn btn-primary" onClick={() => setIsAddUserModalOpen(true)}>
                  <Users size={16} /> Add User
                </button>
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Full Name</th>
                      <th>Group</th>
                      <th>Role</th>
                      <th>Created At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td>{u.fullName || '-'}</td>
                        <td>{u.group ? <span className="badge">{u.group}</span> : '-'}</td>
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
                <div className="upload-dropzone">
                  <input
                    type="file"
                    onChange={(e) => setFileToUpload(e.target.files ? e.target.files[0] : null)}
                  />
                  <div className="upload-instructions">
                    <Upload size={24} color="var(--primary)" style={{ marginBottom: '0.5rem' }} />
                    {fileToUpload ? (
                      <p style={{ wordBreak: 'break-all', overflowWrap: 'break-word', padding: '0 10px' }}>
                        Selected: <strong>{fileToUpload.name}</strong> ({formatSize(fileToUpload.size)})
                      </p>
                    ) : (
                      <>
                        <p>Click to select a file</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Supports CSV, JSON, Excel, etc.</p>
                      </>
                    )}
                  </div>
                </div>
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

      {/* Add User Modal */}
      {isAddUserModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>Add New User</h2>
              <button className="btn-icon" onClick={() => setIsAddUserModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Username (ID) <span className="text-danger">*</span></label>
                  <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} required />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Full Name</label>
                  <input type="text" value={newFullName} onChange={e => setNewFullName(e.target.value)} placeholder="e.g. Taro Yamada" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Group / Department</label>
                  <input type="text" value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="e.g. Sales" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Initial Password <span className="text-danger">*</span></label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={() => setIsAddUserModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
