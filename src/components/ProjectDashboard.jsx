import { useState, useEffect } from 'react'

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProjectDashboard({ userId, onNewProject, onOpenProject }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const loadProjects = () => {
    setLoading(true)
    fetch('/api/project/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setProjects(data.projects)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProjects() }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (projectId) => {
    setDeletingId(projectId)
    setConfirmDeleteId(null)
    try {
      const res = await fetch('/api/project/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setProjects(prev => prev.filter(p => p.id !== projectId))
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleOpen = async (project) => {
    // Fetch full scene JSON for this project
    const res = await fetch('/api/project/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, projectId: project.id }),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      setError(data.error || 'Failed to load project')
      return
    }
    onOpenProject(project.id, project.name, data.sceneJson)
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: '#111', color: 'white',
      fontFamily: 'Arial, sans-serif',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
    }}>
      {/* Header */}
      <div style={{
        width: '100%', maxWidth: '860px',
        padding: '48px 24px 0',
        boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600 }}>Your Projects</h1>
        <button
          onClick={onNewProject}
          style={{
            padding: '10px 20px',
            background: '#4a9eff',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          + New Project
        </button>
      </div>

      {/* Content */}
      <div style={{
        width: '100%', maxWidth: '860px',
        padding: '32px 24px',
        boxSizing: 'border-box',
        flex: 1,
        overflowY: 'auto',
      }}>
        {error && (
          <div style={{
            padding: '12px 16px', background: '#5c1a1a',
            borderRadius: '6px', marginBottom: '20px', fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#888', fontSize: '14px' }}>Loading…</div>
        ) : projects.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '80px 0',
            color: '#666', fontSize: '15px', lineHeight: '1.8',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🪑</div>
            No saved projects yet. Start a new one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {projects.map(project => (
              <div key={project.id} style={{
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderRadius: '8px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    Updated {formatDate(project.updated_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => handleOpen(project)}
                    style={{
                      padding: '8px 16px',
                      background: '#1a3a5c',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'white',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Open
                  </button>

                  {confirmDeleteId === project.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(project.id)}
                        disabled={deletingId === project.id}
                        style={{
                          padding: '8px 12px',
                          background: '#8B0000',
                          border: 'none',
                          borderRadius: '6px',
                          color: 'white',
                          cursor: deletingId === project.id ? 'default' : 'pointer',
                          fontSize: '13px',
                          opacity: deletingId === project.id ? 0.6 : 1,
                        }}
                      >
                        {deletingId === project.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        style={{
                          padding: '8px 10px',
                          background: '#333',
                          border: 'none',
                          borderRadius: '6px',
                          color: '#aaa',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(project.id)}
                      style={{
                        padding: '8px 12px',
                        background: '#2a2a2a',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#888',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
