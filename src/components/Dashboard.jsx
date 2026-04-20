import { useState } from 'react'

export default function Dashboard({ onNavigate }) {
  const [tasks] = useState([
    {
      id: 1,
      title: 'Wave 1: Send 10 warm outreach emails',
      status: 'DONE',
      agent: 'blitzz',
      progress: 100,
      priority: 'HIGH',
      dueDate: '2026-02-21'
    },
    {
      id: 2,
      title: 'Deploy updated UI to hireflow.dev',
      status: 'IN_PROGRESS',
      agent: 'blitzz',
      progress: 75,
      priority: 'CRITICAL',
      dueDate: '2026-02-22'
    },
    {
      id: 3,
      title: 'Monitor email responses from prospects',
      status: 'IN_PROGRESS',
      agent: 'blitzz',
      progress: 50,
      priority: 'HIGH',
      dueDate: '2026-02-28'
    },
    {
      id: 4,
      title: 'Wave 2: Send next 8 outreach emails',
      status: 'PENDING',
      agent: 'blitzz',
      progress: 0,
      priority: 'HIGH',
      dueDate: '2026-02-26'
    },
    {
      id: 5,
      title: 'Schedule demo calls with interested prospects',
      status: 'PENDING',
      agent: 'blitzz',
      progress: 0,
      priority: 'HIGH',
      dueDate: '2026-02-28'
    },
    {
      id: 6,
      title: 'Convert first beta customer',
      status: 'PENDING',
      agent: 'blitzz',
      progress: 0,
      priority: 'CRITICAL',
      dueDate: '2026-03-06'
    }
  ])

  const [agents] = useState([
    {
      id: 'blitzz',
      name: 'blitzz',
      role: 'Lead AI Operator',
      status: 'ACTIVE',
      tasksAssigned: 6,
      tasksDone: 1,
      tasksInProgress: 2
    }
  ])

  const getStatusColor = (status) => {
    switch(status) {
      case 'DONE': return 'bg-[var(--color-success-alpha-12)] text-[var(--color-success-text)]'
      case 'IN_PROGRESS': return 'bg-[var(--color-accent-alpha-08)] text-[var(--color-accent-green)]'
      case 'PENDING': return 'bg-[var(--color-warning-alpha-12)] text-[var(--color-warning-text)]'
      default: return 'bg-[var(--color-white-alpha-08)] text-[var(--color-text-secondary)]'
    }
  }

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'CRITICAL': return 'text-[var(--color-error)]'
      case 'HIGH': return 'text-[var(--color-warning-text)]'
      case 'MEDIUM': return 'text-[var(--color-accent-green)]'
      default: return 'text-[var(--color-text-secondary)]'
    }
  }

  return (
    <div style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '2rem 4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>HireFlow Operations</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>Goal: 5 beta customers by week 8 | Current: Week 1 (warm outreach)</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => onNavigate?.('settings')} style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--color-accent-green)',
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.9rem'
          }}>
            ⚙️ Settings
          </button>
          <button onClick={() => onNavigate?.('landing')} style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--color-text-secondary)',
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.9rem'
          }}>
            ← Home
          </button>
        </div>
      </div>

      {/* Agents Status */}
      <div style={{ padding: '2rem 4rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Active Agents</h2>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {agents.map(agent => (
            <div key={agent.id} style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1.5rem',
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto auto'
            }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{agent.name}</div>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>{agent.role}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Status</div>
                <div style={{ color: 'var(--color-accent-green-hover)', fontWeight: 'bold' }}>{agent.status}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Done</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{agent.tasksDone}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>In Progress</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-accent-green)' }}>{agent.tasksInProgress}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Assigned</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{agent.tasksAssigned}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tasks */}
      <div style={{ padding: '2rem 4rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Tasks & Progress</h2>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {tasks.map(task => (
            <div key={task.id} style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1.5rem'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', fontSize: '1.05rem' }}>{task.title}</div>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Agent: {task.agent}</span>
                    <span className={getPriorityColor(task.priority)}>Priority: {task.priority}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>Due: {task.dueDate}</span>
                  </div>
                </div>
                <span className={getStatusColor(task.status)} style={{ padding: '0.5rem 1rem', borderRadius: '4px', fontSize: '0.875rem', fontWeight: 'bold' }}>
                  {task.status}
                </span>
              </div>
              {/* Progress bar */}
              <div style={{ background: 'rgba(0,0,0,0.3)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  background: task.progress === 100 ? 'var(--color-accent-green-hover)' : 'var(--color-accent-green)',
                  height: '100%',
                  width: `${task.progress}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                {task.progress}% complete
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ padding: '2rem 4rem', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>8-Week Timeline</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '0.5rem' }}>
          {[
            { week: 1, milestone: 'Warm outreach (25 emails)', status: 'IN_PROGRESS' },
            { week: 2, milestone: 'First demo calls', status: 'PENDING' },
            { week: 3, milestone: 'First conversions', status: 'PENDING' },
            { week: 4, milestone: '1st paid customer', status: 'PENDING' },
            { week: 5, milestone: 'Scale outreach', status: 'PENDING' },
            { week: 6, milestone: 'PH pre-launch', status: 'PENDING' },
            { week: 7, milestone: 'Final PH prep', status: 'PENDING' },
            { week: 8, milestone: 'Product Hunt launch', status: 'PENDING' }
          ].map(item => (
            <div key={item.week} style={{
              background: item.status === 'IN_PROGRESS' ? 'rgba(232,255,90,0.1)' : 'var(--card)',
              border: item.status === 'IN_PROGRESS' ? '1px solid var(--color-accent-green)' : '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1rem',
              textAlign: 'center'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--color-accent-green)' }}>W{item.week}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: '1.3' }}>{item.milestone}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '2rem 4rem', borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
        Last updated: {new Date().toLocaleString()}
      </div>
    </div>
  )
}
