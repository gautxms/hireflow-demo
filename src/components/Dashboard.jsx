import { useState } from 'react'
import './Dashboard.css'

export default function Dashboard({ onNavigate }) {
  const [tasks] = useState([])

  const [agents] = useState([])

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
    <div className="legacy-dashboard">
      {/* Header */}
      <div className="legacy-dashboard__header">
        <div>
          <h1 className="legacy-dashboard__title">HireFlow Operations</h1>
          <p className="legacy-dashboard__subtitle">Launch readiness workspace for reviewing operational checklists before customer rollout</p>
        </div>
        <div className="legacy-dashboard__actions">
          <button onClick={() => onNavigate?.('settings')} className="legacy-dashboard__button legacy-dashboard__button--primary">
            ⚙️ Settings
          </button>
          <button onClick={() => onNavigate?.('landing')} className="legacy-dashboard__button legacy-dashboard__button--secondary">
            ← Home
          </button>
        </div>
      </div>

      {/* Agents Status */}
      <div className="legacy-dashboard__section">
        <h2 className="legacy-dashboard__section-title">Active Agents</h2>
        <div className="legacy-dashboard__stack">
          {agents.length === 0 ? (
            <div className="legacy-dashboard__empty">No active operator assignments are configured for this workspace.</div>
          ) : agents.map(agent => (
            <div key={agent.id} className="legacy-dashboard__agent-card">
              <div>
                <div className="legacy-dashboard__item-title legacy-dashboard__item-title--compact">{agent.name}</div>
                <div className="legacy-dashboard__muted legacy-dashboard__text-sm">{agent.role}</div>
              </div>
              <div className="legacy-dashboard__metric">
                <div className="legacy-dashboard__metric-label">Status</div>
                <div className="legacy-dashboard__metric-value legacy-dashboard__metric-value--accent">{agent.status}</div>
              </div>
              <div className="legacy-dashboard__metric">
                <div className="legacy-dashboard__metric-label">Done</div>
                <div className="legacy-dashboard__metric-number">{agent.tasksDone}</div>
              </div>
              <div className="legacy-dashboard__metric">
                <div className="legacy-dashboard__metric-label">In Progress</div>
                <div className="legacy-dashboard__metric-number legacy-dashboard__metric-number--accent">{agent.tasksInProgress}</div>
              </div>
              <div className="legacy-dashboard__metric">
                <div className="legacy-dashboard__metric-label">Assigned</div>
                <div className="legacy-dashboard__metric-number">{agent.tasksAssigned}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tasks */}
      <div className="legacy-dashboard__section">
        <h2 className="legacy-dashboard__section-title">Readiness Checklist</h2>
        <div className="legacy-dashboard__stack">
          {tasks.length === 0 ? (
            <div className="legacy-dashboard__empty">No operational tasks are configured. Add customer-safe checklist items when they are ready to share.</div>
          ) : tasks.map(task => (
            <div key={task.id} className="legacy-dashboard__task-card">
              <div className="legacy-dashboard__task-header">
                <div>
                  <div className="legacy-dashboard__item-title">{task.title}</div>
                  <div className="legacy-dashboard__task-meta">
                    <span className="legacy-dashboard__muted">Owner: {task.agent}</span>
                    <span className={getPriorityColor(task.priority)}>Priority: {task.priority}</span>
                    <span className="legacy-dashboard__muted">Due: {task.dueDate}</span>
                  </div>
                </div>
                <span className={`${getStatusColor(task.status)} legacy-dashboard__status-pill`}>
                  {task.status}
                </span>
              </div>
              {/* Progress bar */}
              <div className="legacy-dashboard__progress-track">
                <div
                  className={`legacy-dashboard__progress-fill${task.progress === 100 ? ' legacy-dashboard__progress-fill--complete' : ''}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>
              <div className="legacy-dashboard__progress-copy">
                {task.progress}% complete
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="legacy-dashboard__section legacy-dashboard__section--bordered">
        <h2 className="legacy-dashboard__section-title">Launch Readiness Areas</h2>
        <div className="legacy-dashboard__area-grid">
          {[
            { week: 1, milestone: 'Environment configuration', status: 'REFERENCE' },
            { week: 2, milestone: 'Upload workflow checks', status: 'REFERENCE' },
            { week: 3, milestone: 'Analysis review checks', status: 'REFERENCE' },
            { week: 4, milestone: 'Billing verification', status: 'REFERENCE' },
            { week: 5, milestone: 'Auth session checks', status: 'REFERENCE' },
            { week: 6, milestone: 'Support readiness', status: 'REFERENCE' },
            { week: 7, milestone: 'Monitoring review', status: 'REFERENCE' },
            { week: 8, milestone: 'Rollback planning', status: 'REFERENCE' }
          ].map(item => (
            <div key={item.week} className={`legacy-dashboard__area-card${item.status === 'IN_PROGRESS' ? ' legacy-dashboard__area-card--active' : ''}`}>
              <div className="legacy-dashboard__area-label">Area {item.week}</div>
              <div className="legacy-dashboard__area-copy">{item.milestone}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="legacy-dashboard__footer">
        Last updated: {new Date().toLocaleString()}
      </div>
    </div>
  )
}
