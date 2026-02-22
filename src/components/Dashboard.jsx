import { useState } from 'react'

export default function Dashboard() {
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
      case 'DONE': return 'bg-emerald-500 bg-opacity-20 text-emerald-300'
      case 'IN_PROGRESS': return 'bg-blue-500 bg-opacity-20 text-blue-300'
      case 'PENDING': return 'bg-amber-500 bg-opacity-20 text-amber-300'
      default: return 'bg-gray-500 bg-opacity-20 text-gray-300'
    }
  }

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'CRITICAL': return 'text-red-400'
      case 'HIGH': return 'text-orange-400'
      case 'MEDIUM': return 'text-yellow-400'
      default: return 'text-gray-400'
    }
  }

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '2rem 4rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>HireFlow Operations</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>Goal: 5 beta customers by week 8 | Current: Week 1 (warm outreach)</p>
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
                <div style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{agent.role}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Status</div>
                <div style={{ color: 'var(--accent-2)', fontWeight: 'bold' }}>{agent.status}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Done</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{agent.tasksDone}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>In Progress</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)' }}>{agent.tasksInProgress}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Assigned</div>
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
                    <span style={{ color: 'var(--muted)' }}>Agent: {task.agent}</span>
                    <span className={getPriorityColor(task.priority)}>Priority: {task.priority}</span>
                    <span style={{ color: 'var(--muted)' }}>Due: {task.dueDate}</span>
                  </div>
                </div>
                <span className={getStatusColor(task.status)} style={{ padding: '0.5rem 1rem', borderRadius: '4px', fontSize: '0.875rem', fontWeight: 'bold' }}>
                  {task.status}
                </span>
              </div>
              {/* Progress bar */}
              <div style={{ background: 'rgba(0,0,0,0.3)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  background: task.progress === 100 ? 'var(--accent-2)' : 'var(--accent)',
                  height: '100%',
                  width: `${task.progress}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--muted)' }}>
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
              border: item.status === 'IN_PROGRESS' ? '1px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: '8px',
              padding: '1rem',
              textAlign: 'center'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--accent)' }}>W{item.week}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: '1.3' }}>{item.milestone}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '2rem 4rem', borderTop: '1px solid var(--border)', textAlign: 'center', color: 'var(--muted)', fontSize: '0.875rem' }}>
        Last updated: {new Date().toLocaleString()}
      </div>
    </div>
  )
}
