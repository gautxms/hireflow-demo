import {
  normalizeCandidateMatchScore,
  resolveCandidateMatchLabel,
  resolveCandidateMatchTier,
} from '../../../shared/candidateMatchClassification.js'

export const HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI = 'ui://hireflow/analysis-results-v5.html'
export const HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app'

export function resolveHireFlowAnalysisProgressCounts(data = {}) {
  const files = Array.isArray(data?.files) ? data.files : []
  const fileQueued = files.filter((file) => file?.status === 'queued').length
  const fileFailed = files.filter((file) => file?.status === 'failed').length
  const source = data?.counts && typeof data.counts === 'object' ? data.counts : data
  const count = (value, fallback = 0) => {
    const numeric = Number(value ?? fallback)
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
  }
  const queued = count(source?.queued, fileQueued)
  const failed = count(source?.failed, fileFailed)
  const complete = count(source?.complete)
  const processing = count(source?.processing)
  return {
    total: count(source?.total, files.length || complete + processing + queued + failed),
    complete,
    failed,
    processing,
    queued,
  }
}

export function resolveHireFlowAnalysisRankingStats(data = {}) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : []
  const scores = candidates.map((candidate) => {
    const scoreOutOfTen = candidate?.scoreOutOfTen
    if (scoreOutOfTen !== null && scoreOutOfTen !== undefined && scoreOutOfTen !== '') {
      const numeric = Number(scoreOutOfTen)
      if (Number.isFinite(numeric)) return Math.max(0, Math.min(100, numeric * 10))
    }
    const score = candidate?.score
    if (score !== null && score !== undefined && score !== '') {
      const numeric = Number(score)
      if (Number.isFinite(numeric)) return Math.max(0, Math.min(100, numeric))
    }
    return 0
  })
  const averagePercent = candidates.length
    ? Math.round(scores.reduce((total, score) => total + score, 0) / candidates.length)
    : 0
  return {
    analysed: candidates.length,
    strongMatches: scores.filter((score) => resolveCandidateMatchTier(score) === 'strong').length,
    averageScore: (averagePercent / 10).toFixed(1),
  }
}

export const HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HireFlow analysis results</title>
  <style>
    @font-face { font-family: "Syne Local"; src: url("https://hireflow.dev/fonts/syne-latin-600-normal.woff2") format("woff2"); font-style: normal; font-weight: 600; font-display: swap; }
    @font-face { font-family: "Syne Local"; src: url("https://hireflow.dev/fonts/syne-latin-700-normal.woff2") format("woff2"); font-style: normal; font-weight: 700; font-display: swap; }
    @font-face { font-family: "Syne Local"; src: url("https://hireflow.dev/fonts/syne-latin-800-normal.woff2") format("woff2"); font-style: normal; font-weight: 800; font-display: swap; }
    :root {
      color-scheme: dark;
      font-family: "DM Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --hf-bg: #0a0a0a; --hf-surface: #111111; --hf-surface-2: #0d0d0d;
      --hf-border: #1e1e1e; --hf-border-2: #555555;
      --hf-text-1: #ffffff; --hf-text-2: #aaaaaa; --hf-text-3: #888888; --hf-text-4: #666666;
      --hf-lime: #c8ff00; --hf-lime-hover: #b8ec00; --hf-success: #10b981; --hf-warning: #fcd34d; --hf-error: #ef4444;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: transparent; color: var(--hf-text-1); }
    body { padding: 0; }
    button { font: inherit; }
    button:focus-visible, .result-card:focus-visible { outline: 2px solid var(--hf-lime); outline-offset: 2px; }
    .analysis-results-shell { overflow: visible; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
    .analysis-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 12px 12px 14px; padding: 13px 16px; border: 1px solid rgba(255,255,255,.06); border-radius: 12px; background: linear-gradient(180deg,rgba(17,17,17,.92),rgba(15,15,15,.9)); }
    .analysis-header-main { display: flex; align-items: baseline; flex: 1; min-width: 0; flex-wrap: wrap; gap: 7px 12px; }
    .analysis-title { margin: 0; font-family: "Syne Local", "DM Sans", sans-serif; font-size: clamp(21px,2.7vw,28px); line-height: 1.1; }
    .analysis-subhead { margin: 0; color: var(--hf-text-3); font-size: 13px; }
    .analysis-count { color: var(--hf-text-4); }
    .analysis-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .hf-button { min-height: 38px; border: 1px solid var(--hf-border-2); border-radius: 8px; padding: 8px 12px; background: transparent; color: var(--hf-text-2); cursor: pointer; font-weight: 600; }
    .hf-button:hover { border-color: rgba(200,255,0,.38); color: var(--hf-text-1); }
    .hf-button--primary { border-color: var(--hf-lime); background: var(--hf-lime); color: var(--hf-bg); }
    .hf-button--primary:hover { background: var(--hf-lime-hover); color: var(--hf-bg); }
    .results-content { padding: 0 12px 16px; }
    .ranking-stats { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin-bottom: 16px; }
    .ranking-stat { padding: 16px 18px; text-align: left; border: 1px solid rgba(255,255,255,.07); border-radius: 12px; background: radial-gradient(circle at top right,rgba(200,255,0,.08),transparent 46%),linear-gradient(180deg,rgba(18,18,18,.96),rgba(14,14,14,.96)); }
    .ranking-stat-num { color: var(--hf-text-1); font-family: "Syne Local", "DM Sans", sans-serif; font-size: min(28px,7vw); font-weight: 700; line-height: 1; }
    .ranking-stat-num--strong { color: var(--hf-lime); }
    .ranking-stat-label { margin-top: 6px; color: var(--hf-text-4); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
    .results-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: start; gap: 12px; }
    .result-card { width: 100%; background: linear-gradient(180deg,rgba(17,17,17,.95),rgba(14,14,14,.95)); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 13px 14px; color: inherit; cursor: pointer; position: relative; transition: border-color .15s,background .15s; display: flex; flex-direction: column; gap: 8px; text-align: left; }
    .result-card:hover { border-color: rgba(200,255,0,.24); background: linear-gradient(180deg,rgba(20,20,20,.96),rgba(16,16,16,.96)); }
    .result-card--open { border-color: rgba(200,255,0,.3); }
    .rc-rank { font-size: 11px; font-weight: 700; color: #5d616a; margin-bottom: 2px; }
    .rc-top { display: flex; align-items: flex-start; gap: 12px; }
    .rc-avatar { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; background: rgba(200,255,0,.08); border: 1px solid rgba(200,255,0,.15); color: var(--hf-lime); font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .rc-identity { flex: 1; min-width: 0; }
    .rc-name { font-family: "Syne Local", "DM Sans", sans-serif; font-size: 1rem; font-weight: 700; color: var(--hf-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rc-meta { font-size: 12px; color: var(--hf-text-3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rc-score-block { text-align: right; flex-shrink: 0; }
    .rc-score-num { font-family: "Syne Local", "DM Sans", sans-serif; font-size: 32px; font-weight: 800; line-height: 1; color: var(--hf-text-1); }
    .rc-score-denom { font-size: 13px; font-weight: 400; color: var(--hf-text-3); }
    .rc-fit-label { font-size: 12px; font-weight: 600; margin-top: 3px; }
    .rc-fit--strong { color: var(--hf-lime); } .rc-fit--possible { color: var(--hf-warning); } .rc-fit--low { color: var(--hf-error); } .rc-fit--unscored { color: var(--hf-text-4); }
    .rc-rationale { font-size: 13px; color: var(--hf-text-2); line-height: 1.4; min-height: 1.35em; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .rc-skills { display: flex; gap: 5px; flex-wrap: wrap; }
    .rc-skill { font-size: 11px; color: #aab0bb; background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.08); padding: 3px 8px; border-radius: 999px; }
    .rc-skill-more { font-size: 11px; color: var(--hf-text-4); padding: 2px 4px; }
    .rc-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.06); margin-top: 2px; }
    .rc-footer-meta { font-size: 11px; color: var(--hf-text-4); }
    .rc-expand-hint { font-size: 11px; color: #9ea4af; border: 1px solid rgba(255,255,255,.13); border-radius: 999px; padding: 4px 10px; background: rgba(255,255,255,.02); }
    .result-card:hover .rc-expand-hint, .result-card--open .rc-expand-hint { color: rgba(200,255,0,.95); border-color: rgba(200,255,0,.35); background: rgba(200,255,0,.08); }
    .detail-drawer { background: var(--hf-surface); border: 1px solid rgba(200,255,0,.2); border-radius: 16px; padding: 24px; margin-top: 14px; animation: drawerIn .2s ease; }
    @keyframes drawerIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .dd-header { display: grid; grid-template-columns: minmax(320px,1fr) minmax(220px,auto) auto; align-items: center; gap: 18px; margin-bottom: 14px; padding: 4px 0 18px; border-bottom: 1px solid var(--hf-border); }
    .dd-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .dd-avatar { width: 54px; height: 54px; border-radius: 50%; flex-shrink: 0; background: rgba(200,255,0,.12); border: 1px solid rgba(200,255,0,.26); color: var(--hf-lime); font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .dd-header-info { flex: 1; min-width: 140px; }
    .dd-name { font-family: "Syne Local", "DM Sans", sans-serif; font-size: 30px; font-weight: 700; color: var(--hf-text-1); line-height: 1.1; }
    .dd-subtitle { font-size: 14px; color: var(--hf-text-3); margin-top: 4px; }
    .dd-meta-facts { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
    .dd-meta-item { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--hf-text-2); }
    .dd-header-middle { display: flex; justify-content: center; min-width: 220px; }
    .dd-score-panel { text-align: center; min-width: 140px; }
    .dd-score { font-family: "Syne Local", "DM Sans", sans-serif; font-size: 56px; font-weight: 800; line-height: .95; }
    .dd-score span { font-size: 24px; font-weight: 500; color: var(--hf-text-3); }
    .dd-score-panel--strong .dd-score, .dd-fit--strong { color: var(--hf-success); } .dd-score-panel--possible .dd-score, .dd-fit--possible { color: var(--hf-warning); } .dd-score-panel--low .dd-score, .dd-fit--low { color: var(--hf-error); } .dd-score-panel--unscored .dd-score, .dd-fit--unscored { color: var(--hf-text-3); }
    .dd-fit-label { font-size: 16px; margin-top: 6px; font-weight: 600; }
    .dd-confidence { margin-top: 2px; color: var(--hf-text-3); font-size: 12px; }
    .dd-header-actions { display: flex; align-items: center; justify-content: flex-end; justify-self: end; gap: 8px; }
    .dd-close { width: 36px; height: 36px; padding: 0; border-radius: 8px; border: 1px solid var(--hf-border-2); background: rgba(255,255,255,.04); color: var(--hf-text-2); cursor: pointer; font-size: 20px; }
    .dd-close:hover { color: var(--hf-text-1); border-color: rgba(255,255,255,.24); background: rgba(255,255,255,.1); }
    .dd-body { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 18px; align-items: start; }
    .dd-col { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
    .dd-section-card { background: linear-gradient(180deg,rgba(17,17,17,.96),var(--hf-surface-2)); border: 1px solid var(--hf-border-2); border-radius: 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,.025),0 10px 24px rgba(0,0,0,.14); padding: 16px; }
    .dd-section-card--compact { min-height: 104px; }
    .dd-col-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--hf-text-3); margin-bottom: 8px; }
    .dd-summary { margin: 0; font-size: 13px; color: var(--hf-text-2); line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
    .dd-summary--clamp-5,.dd-summary--clamp-6 { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
    .dd-summary--clamp-5 { -webkit-line-clamp: 5; } .dd-summary--clamp-6 { -webkit-line-clamp: 6; }
    .dd-recommended-action { margin: 0; border-left: 2px solid var(--hf-lime); background: rgba(200,255,0,.05); padding: 10px 12px; color: var(--hf-text-2); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
    .dd-facts-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .dd-fact-card { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 10px; border: 1px solid var(--hf-border); border-radius: 8px; background: var(--hf-surface-2); }
    .dd-fact-k { color: var(--hf-text-3); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    .dd-fact-v { color: var(--hf-text-2); font-size: 11px; font-weight: 500; line-height: 1.4; overflow-wrap: anywhere; }
    .dd-analysis-box { background: color-mix(in srgb,var(--hf-bg) 38%,var(--hf-surface-2)); border-radius: 10px; padding: 12px; border: 1px solid var(--hf-border); }
    .dd-analysis-box--green { border-top-color: rgba(200,255,0,.2); } .dd-analysis-box--amber { border-top-color: rgba(255,165,0,.2); }
    .dd-list { display: flex; flex-direction: column; }
    .dd-list-item { display: flex; gap: 8px; align-items: flex-start; color: var(--hf-text-2); font-size: 13px; line-height: 1.45; padding: 4px 0; }
    .dd-list-icon { color: var(--hf-lime); flex: 0 0 auto; font-weight: 700; } .dd-list-item--warn .dd-list-icon { color: var(--hf-warning); }
    .dd-analysis-empty { font-size: 12px; color: var(--hf-text-4); font-style: italic; }
    .dd-top-skills { display: flex; gap: 5px; flex-wrap: wrap; }
    .dd-top-skill { font-size: 12px; color: var(--hf-lime); background: rgba(200,255,0,.07); border: 1px solid rgba(200,255,0,.18); padding: 3px 9px; border-radius: 999px; overflow-wrap: anywhere; }
    .dd-top-skill--matched { background: rgba(200,255,0,.1); border-color: rgba(200,255,0,.25); } .dd-top-skill--warn { color: var(--hf-warning); background: rgba(255,165,0,.1); border-color: rgba(255,165,0,.3); } .dd-top-skill--all { color: var(--hf-text-2); background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.12); }
    .dd-count-badge { margin-left: 8px; font-size: 12px; font-weight: 500; } .dd-count-badge--lime { color: var(--hf-lime); } .dd-count-badge--amber { display: inline-flex; align-items: center; padding: 1px 8px; border: 1px solid rgba(252,211,77,.38); border-radius: 999px; background: rgba(252,211,77,.14); color: var(--hf-warning); }
    .dd-breakdown { display: flex; flex-direction: column; gap: 8px; }
    .dd-breakdown-row { display: grid; grid-template-columns: minmax(92px,1fr) 1fr auto; gap: 8px; align-items: center; font-size: 12px; color: var(--hf-text-2); }
    .dd-breakdown-track { height: 8px; overflow: hidden; border-radius: 999px; background: #2a2a2a; }
    .dd-breakdown-fill { display: block; height: 100%; border-radius: 999px; }
    .dd-breakdown-fill--strong { background: var(--hf-lime); } .dd-breakdown-fill--possible { background: var(--hf-warning); } .dd-breakdown-fill--low { background: var(--hf-error); }
    .dd-inline-disclosure { min-height: 24px; margin-top: 8px; padding: 2px 8px; border: 1px solid #2a2a2a; border-radius: 999px; background: transparent; color: var(--hf-lime); cursor: pointer; font-size: 12px; font-weight: 600; }
    .dd-inline-disclosure:hover { border-color: rgba(200,255,0,.4); background: rgba(200,255,0,.08); }
    .dd-section-card--resume { min-height: auto; }
    .dd-resume-file { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--hf-border-2); border-radius: 12px; background: linear-gradient(135deg,rgba(17,17,17,.82),var(--hf-surface-2)); }
    .dd-resume-icon { display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; border: 1px solid var(--hf-border); border-radius: 10px; background: rgba(200,255,0,.08); color: var(--hf-lime); font-size: 17px; }
    .dd-resume-copy { min-width: 0; }
    .dd-resume-filename { overflow: hidden; color: var(--hf-text-1); font-size: 13px; font-weight: 600; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .dd-resume-meta { margin-top: 2px; color: var(--hf-text-3); font-size: 12px; line-height: 1.35; }
    .empty, .failure { color: var(--hf-text-3); font-size: 13px; } .empty { padding: 26px 18px; text-align: center; } .failure { margin-top: 14px; padding: 12px; border: 1px solid rgba(239,68,68,.28); border-radius: 10px; }
    .status-wrap { padding: 24px 20px; }
    .status-row { display: flex; align-items: center; gap: 12px; }
    .spinner { width: 20px; height: 20px; border: 3px solid var(--hf-border-2); border-top-color: var(--hf-lime); border-radius: 999px; animation: spin .9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status-title { margin: 0; font-family: "Syne Local", "DM Sans", sans-serif; font-size: 16px; font-weight: 700; }
    .status-copy { margin: 4px 0 0; color: var(--hf-text-3); font-size: 13px; }
    .progress { height: 6px; margin-top: 16px; overflow: hidden; border-radius: 999px; background: #1e1e1e; }
    .progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,var(--hf-lime),#39ff9f); transition: width .25s ease; }
    .error { padding: 24px 18px; text-align: center; } .error p { color: var(--hf-text-3); }
    @media (max-width: 1140px) { .dd-header { grid-template-columns: 1fr; align-items: flex-start; } .dd-header-middle,.dd-score-panel { min-width: 0; justify-content: flex-start; text-align: left; } .dd-header-actions { justify-self: start; } }
    @media (max-width: 1024px) { .results-grid,.dd-body { grid-template-columns: 1fr; } }
    @media (max-width: 840px) { .ranking-stats { gap: 7px; } .ranking-stat { min-width: 0; padding: 12px 10px; } .ranking-stat-num { font-size: 22px; } .ranking-stat-label { font-size: 10px; } }
    @media (max-width: 620px) { .analysis-header { align-items: flex-start; flex-direction: column; } .analysis-actions { justify-content: flex-start; } .results-content { padding: 0 12px 12px; } .ranking-stats { gap: 5px; } .ranking-stat { padding: 10px 8px; } .detail-drawer { padding: 16px; } .dd-name { font-size: 24px; } }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <main class="analysis-results-shell" id="app" aria-live="polite"><div class="status-wrap"><div class="status-row"><div class="spinner" aria-hidden="true"></div><div><p class="status-title">Loading HireFlow results…</p><p class="status-copy">Retrieving the authoritative analysis.</p></div></div></div></main>
  <script type="module">
    const app = document.querySelector('#app');
    let currentData = window.openai?.toolOutput || null;
    let expandedCandidateId = String(window.openai?.widgetState?.privateContent?.expandedCandidateId || '');
    let pollTimer = null;
    let pollAttempts = 0;
    let rpcId = 0;
    let hostContext = {};
    const pendingRequests = new Map();

    const create = (tag, className, content) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (content !== undefined && content !== null) element.textContent = String(content);
      return element;
    };
    const safeText = (value, fallback = '') => {
      const normalized = value === null || value === undefined ? '' : String(value).trim();
      return normalized || fallback;
    };
    const safeList = (value) => Array.isArray(value) ? value.map((item) => safeText(item)).filter(Boolean) : [];
    const getCandidateId = (candidate, index) => safeText(candidate?.id || candidate?.resumeId, String(index));
    const initials = (name) => safeText(name, 'Candidate').split(/\s+/).filter(Boolean).slice(0,2).map((part) => part.charAt(0).toUpperCase()).join('') || 'NA';
    const getScore = (candidate) => {
      const raw = candidate?.scoreOutOfTen;
      const numeric = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
      return Number.isFinite(numeric) ? Math.max(0, Math.min(10, numeric)) : Number.NaN;
    };
    const normalizeCandidateMatchScore = ${normalizeCandidateMatchScore.toString()};
    const resolveCandidateMatchTier = ${resolveCandidateMatchTier.toString()};
    const resolveCandidateMatchLabel = ${resolveCandidateMatchLabel.toString()};
    const scoreTone = (score) => resolveCandidateMatchTier(score);
    const verdictLabel = (candidate) => {
      return resolveCandidateMatchLabel(getScore(candidate));
    };
    const saveUiState = () => window.openai?.setWidgetState?.({ modelContent: 'Viewing HireFlow analysis results.', privateContent: { expandedCandidateId } });
    const resolveProgressCounts = ${resolveHireFlowAnalysisProgressCounts.toString()};
    const resolveRankingStats = ${resolveHireFlowAnalysisRankingStats.toString()};
    const openHireFlow = async (url) => {
      if (!url) return;
      if (window.openai?.openExternal) return window.openai.openExternal({ href: url, redirectUrl: false });
      window.open(url, '_blank', 'noopener,noreferrer');
    };
    const section = (title, badgeText = '', badgeClass = '', modifier = '') => {
      const node = create('section', 'dd-section-card' + (modifier ? ' ' + modifier : ''));
      const label = create('div', 'dd-col-label', title);
      if (badgeText) label.append(create('span', 'dd-count-badge ' + badgeClass, badgeText));
      node.append(label);
      return node;
    };
    const appendDisclosure = (parent, renderItems) => {
      let expanded = false;
      const button = create('button', 'dd-inline-disclosure', 'Show more');
      button.type = 'button';
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => {
        expanded = !expanded;
        button.textContent = expanded ? 'Show less' : 'Show more';
        button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        renderItems(expanded);
        window.openai?.notifyIntrinsicHeight?.();
      });
      parent.append(button);
    };
    const appendExpandableText = (parent, value, fallback, lineLimit, modifier = '') => {
      const text = safeText(value, fallback);
      const clampClass = 'dd-summary--clamp-' + lineLimit;
      const paragraph = create('p', 'dd-summary ' + clampClass + (modifier ? ' ' + modifier : ''), text);
      parent.append(paragraph);
      if (text.length > lineLimit * 70) {
        appendDisclosure(parent, (expanded) => paragraph.classList.toggle(clampClass, !expanded));
      }
    };
    const appendPills = (parent, items, modifier, emptyCopy, previewCount = Infinity) => {
      const values = safeList(items);
      if (!values.length) return parent.append(create('p', 'dd-summary', emptyCopy));
      const pills = create('div', 'dd-top-skills');
      parent.append(pills);
      const renderItems = (expanded) => {
        pills.replaceChildren();
        values.slice(0, expanded ? values.length : previewCount).forEach((item) => pills.append(create('span', 'dd-top-skill ' + modifier, item)));
      };
      renderItems(false);
      if (values.length > previewCount) appendDisclosure(parent, renderItems);
    };
    const appendAnalysisList = (parent, items, warning, emptyCopy, previewCount = Infinity) => {
      const values = safeList(items);
      if (!values.length) return parent.append(create('div', 'dd-analysis-empty', emptyCopy));
      const rows = create('div', 'dd-list');
      parent.append(rows);
      const renderItems = (expanded) => {
        rows.replaceChildren();
        values.slice(0, expanded ? values.length : previewCount).forEach((item) => {
          const row = create('div', warning ? 'dd-list-item dd-list-item--warn' : 'dd-list-item');
          row.append(create('span', 'dd-list-icon', warning ? '!' : '✓'));
          row.append(create('span', '', item));
          rows.append(row);
        });
      };
      renderItems(false);
      if (values.length > previewCount) appendDisclosure(parent, renderItems);
    };

    const renderCandidateCard = (candidate, index) => {
      const id = getCandidateId(candidate, index);
      const score = getScore(candidate);
      const tone = scoreTone(score);
      const hasSelectedJob = Boolean(currentData?.job);
      const yearsRaw = candidate?.yearsExperience;
      const yearsNumeric = yearsRaw === null || yearsRaw === undefined || yearsRaw === '' ? Number.NaN : Number(yearsRaw);
      const years = Number.isFinite(yearsNumeric) ? yearsNumeric : 0;
      const card = create('div', 'result-card result-card--' + tone + (expandedCandidateId === id ? ' result-card--open' : ''));
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.setAttribute('aria-expanded', expandedCandidateId === id ? 'true' : 'false');
      card.setAttribute('aria-controls', 'candidate-detail');
      const toggleDetail = () => { expandedCandidateId = expandedCandidateId === id ? '' : id; saveUiState(); render(currentData); };
      card.addEventListener('click', toggleDetail);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleDetail();
      });
      if (hasSelectedJob) card.append(create('div', 'rc-rank', '#' + (index + 1)));
      const top = create('div', 'rc-top');
      top.append(create('div', 'rc-avatar', initials(candidate?.name)));
      const identity = create('div', 'rc-identity');
      identity.append(create('div', 'rc-name', safeText(candidate?.name, 'Candidate')));
      const meta = [candidate?.title, candidate?.location].map((item) => safeText(item)).filter(Boolean).join(' · ');
      identity.append(create('div', 'rc-meta', meta || safeText(candidate?.filename, 'Candidate profile')));
      top.append(identity);
      if (hasSelectedJob) {
        const scoreBlock = create('div', 'rc-score-block');
        const number = create('div', 'rc-score-num', Number.isFinite(score) ? score.toFixed(1) : '—');
        if (Number.isFinite(score)) number.append(create('span', 'rc-score-denom', '/10'));
        scoreBlock.append(number);
        scoreBlock.append(create('div', 'rc-fit-label rc-fit--' + tone, verdictLabel(candidate)));
        top.append(scoreBlock);
      }
      card.append(top);
      card.append(create('div', 'rc-rationale', safeText(candidate?.reason || candidate?.summary, 'HireFlow analysis details are available below.')));
      const skillValues = safeList(candidate?.skills);
      const skills = create('div', 'rc-skills');
      if (skillValues.length) {
        skillValues.slice(0,3).forEach((skill) => skills.append(create('span', 'rc-skill', skill)));
        if (skillValues.length > 3) skills.append(create('span', 'rc-skill-more', '+' + (skillValues.length - 3)));
      } else skills.append(create('span', 'rc-skill-more', 'Relevant skills unavailable for this analysis'));
      card.append(skills);
      const footer = create('div', 'rc-footer');
      const experience = Number(candidate?.yearsExperience) > 0 ? candidate.yearsExperience + ' yrs exp' : 'Experience unavailable';
      const seniority = safeText(candidate?.seniorityLevel, 'Seniority unavailable');
      footer.append(create('span', 'rc-footer-meta', experience + ' · ' + seniority));
      footer.append(create('span', 'rc-expand-hint', expandedCandidateId === id ? 'Collapse details' : 'Expand details'));
      card.append(footer);
      return card;
    };

    const renderCandidateDetail = (candidate) => {
      const score = getScore(candidate);
      const tone = scoreTone(score);
      const hasSelectedJob = Boolean(currentData?.job);
      const drawer = create('section', 'detail-drawer');
      drawer.id = 'candidate-detail';
      const header = create('div', 'dd-header');
      const left = create('div', 'dd-header-left');
      left.append(create('div', 'dd-avatar', initials(candidate?.name)));
      const info = create('div', 'dd-header-info');
      info.append(create('div', 'dd-name', safeText(candidate?.name, 'Candidate')));
      info.append(create('div', 'dd-subtitle', safeText(candidate?.title, 'Candidate profile')));
      const facts = create('div', 'dd-meta-facts');
      facts.append(create('span', 'dd-meta-item', years + ' yrs exp'));
      facts.append(create('span', 'dd-meta-item', safeText(candidate?.location, 'Location unavailable')));
      facts.append(create('span', 'dd-meta-item', safeText(candidate?.seniorityLevel, 'Seniority unavailable')));
      info.append(facts);
      left.append(info);
      header.append(left);
      const middle = create('div', 'dd-header-middle');
      if (hasSelectedJob) {
        const scorePanel = create('div', 'dd-score-panel dd-score-panel--' + tone);
        const scoreNode = create('div', 'dd-score', Number.isFinite(score) ? score.toFixed(1) : '—');
        if (Number.isFinite(score)) scoreNode.append(create('span', '', '/10'));
        scorePanel.append(scoreNode);
        scorePanel.append(create('div', 'dd-fit-label dd-fit--' + tone, verdictLabel(candidate)));
        if (safeText(candidate?.confidenceLabel)) scorePanel.append(create('div', 'dd-confidence', candidate.confidenceLabel));
        middle.append(scorePanel);
      }
      header.append(middle);
      const actions = create('div', 'dd-header-actions');
      const close = create('button', 'dd-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close candidate details');
      close.addEventListener('click', () => { expandedCandidateId = ''; saveUiState(); render(currentData); });
      actions.append(close);
      header.append(actions);
      drawer.append(header);
      const body = create('div', 'dd-body');
      const first = create('div', 'dd-col');
      const summary = section('Summary');
      appendExpandableText(summary, candidate?.summary, 'Summary not available.', 5);
      first.append(summary);
      if (hasSelectedJob) {
        const breakdown = section('Score breakdown');
        const breakdownRows = (Array.isArray(candidate?.breakdown) ? candidate.breakdown : []).filter((item) => Number.isFinite(Number(item?.value)));
        if (breakdownRows.length) {
          const box = create('div', 'dd-analysis-box dd-breakdown');
          breakdownRows.forEach((item) => {
            const value = Math.max(0, Math.min(100, Number(item.value)));
            const row = create('div', 'dd-breakdown-row');
            row.append(create('span', '', safeText(item?.label || item?.key, 'Detail')));
            const track = create('span', 'dd-breakdown-track');
            const fill = create('span', 'dd-breakdown-fill ' + (value >= 75 ? 'dd-breakdown-fill--strong' : value >= 50 ? 'dd-breakdown-fill--possible' : 'dd-breakdown-fill--low'));
            fill.style.width = value + '%';
            track.append(fill);
            row.append(track);
            row.append(create('span', '', value + '%'));
            box.append(row);
          });
          breakdown.append(box);
        } else breakdown.append(create('p', 'dd-summary', 'Score breakdown unavailable'));
        first.append(breakdown);
      }
      if (hasSelectedJob && safeText(candidate?.recommendation)) {
        const recommendation = section('Recommended action', '', '', 'dd-section-card--compact');
        appendExpandableText(recommendation, candidate.recommendation, '', 5, 'dd-recommended-action');
        first.append(recommendation);
      }
      const keyFacts = [
        ['Experience', years + ' years'],
        ['Location', safeText(candidate?.location)],
        ['Seniority', safeText(candidate?.seniorityLevel)],
        ['Education', safeText(candidate?.education)],
      ].filter((item) => item[1]);
      if (keyFacts.length) {
        const factsSection = section('Key facts', '', '', 'dd-section-card--compact');
        const factsGrid = create('div', 'dd-facts-grid');
        keyFacts.forEach(([label,value]) => {
          const fact = create('div', 'dd-fact-card');
          fact.append(create('span', 'dd-fact-k', label));
          fact.append(create('span', 'dd-fact-v', value));
          factsGrid.append(fact);
        });
        factsSection.append(factsGrid);
        first.append(factsSection);
      }
      const reasoning = section('AI reasoning', '', '', 'dd-section-card--compact');
      appendExpandableText(reasoning, candidate?.reason, 'Reasoning not available.', 6);
      first.append(reasoning);
      body.append(first);
      const second = create('div', 'dd-col');
      const matchedItems = safeList(candidate?.matchedRequirements);
      const missingItems = safeList(candidate?.missingRequirements);
      if (hasSelectedJob) {
        const matched = section('Matched skills', '✓ ' + matchedItems.length + ' of ' + (matchedItems.length + missingItems.length) + ' required', 'dd-count-badge--lime', 'dd-section-card--compact');
        appendPills(matched, matchedItems, 'dd-top-skill--matched', 'No matched skills were returned.', 5);
        second.append(matched);
        const missing = section('Skill gaps', missingItems.length ? missingItems.length + ' gaps identified' : '', 'dd-count-badge--amber', 'dd-section-card--compact');
        appendPills(missing, missingItems, 'dd-top-skill--warn', 'No explicit skill gaps identified.', 3);
        second.append(missing);
      }
      const allSkills = safeList(candidate?.skills);
      if (allSkills.length) {
        const skills = section('All skills', '', '', 'dd-section-card--compact');
        appendPills(skills, allSkills, 'dd-top-skill--all', 'Skills not available.', 12);
        second.append(skills);
      }
      body.append(second);
      const third = create('div', 'dd-col');
      const strengths = section('Strengths');
      const strengthsBox = create('div', 'dd-analysis-box dd-analysis-box--green');
      appendAnalysisList(strengthsBox, candidate?.strengths, false, 'Re-analyse to generate AI strengths', 3);
      strengths.append(strengthsBox);
      third.append(strengths);
      const considerations = section('Considerations', '', '', 'dd-section-card--compact');
      const considerationsBox = create('div', 'dd-analysis-box dd-analysis-box--amber');
      appendAnalysisList(considerationsBox, candidate?.considerations, true, 'Run re-analysis to generate detailed AI considerations', 3);
      considerations.append(considerationsBox);
      third.append(considerations);
      const resume = section('Resume', '', '', 'dd-section-card--compact dd-section-card--resume');
      const resumeFile = create('div', 'dd-resume-file');
      resumeFile.append(create('div', 'dd-resume-icon', '▤'));
      const resumeCopy = create('div', 'dd-resume-copy');
      resumeCopy.append(create('div', 'dd-resume-filename', safeText(candidate?.filename, 'Resume unavailable')));
      resumeFile.append(resumeCopy);
      resume.append(resumeFile);
      third.append(resume);
      body.append(third);
      drawer.append(body);
      return drawer;
    };

    const renderStatus = (data) => {
      const counts = resolveProgressCounts(data);
      const total = Number(counts.total || 0);
      const done = Number(counts.complete || 0) + Number(counts.failed || 0);
      const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      app.replaceChildren();
      const wrap = create('div', 'status-wrap');
      const row = create('div', 'status-row');
      row.append(create('div', 'spinner'));
      const copy = create('div');
      copy.append(create('p', 'status-title', 'HireFlow is analysing ' + total + ' resume' + (total === 1 ? '' : 's') + '…'));
      copy.append(create('p', 'status-copy', done + ' completed · ' + Number(counts.processing || 0) + ' processing · ' + Number(counts.queued || 0) + ' queued'));
      row.append(copy);
      wrap.append(row);
      const progress = create('div', 'progress');
      const fill = create('span');
      fill.style.width = percent + '%';
      progress.append(fill);
      wrap.append(progress);
      app.append(wrap);
    };

    const render = (data) => {
      if (!data || typeof data !== 'object') return;
      currentData = data;
      const status = safeText(data.status).toLowerCase();
      if (status === 'processing' || status === 'queued') { renderStatus(data); schedulePoll(); return; }
      if (pollTimer) clearTimeout(pollTimer);
      app.replaceChildren();
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const header = create('header', 'analysis-header');
      const heading = create('div', 'analysis-header-main');
      heading.append(create('h1', 'analysis-title', safeText(data.name, 'Analysis results')));
      const subhead = create('p', 'analysis-subhead');
      subhead.append(document.createTextNode(data?.job?.title || 'Resume-only analysis'));
      const countLabel = data.job ? 'ranked candidate' : 'analysed candidate';
      subhead.append(create('span', 'analysis-count', ' · ' + candidates.length + ' ' + countLabel + (candidates.length === 1 ? '' : 's')));
      heading.append(subhead);
      header.append(heading);
      const actions = create('div', 'analysis-actions');
      const fullscreen = create('button', 'hf-button', 'Fullscreen');
      fullscreen.type = 'button';
      fullscreen.addEventListener('click', requestFullscreen);
      actions.append(fullscreen);
      if (data.url) {
        const open = create('button', 'hf-button hf-button--primary', 'Open in HireFlow');
        open.type = 'button';
        open.addEventListener('click', () => openHireFlow(data.url));
        actions.append(open);
        window.openai?.setOpenInAppUrl?.({ href: data.url });
      }
      header.append(actions);
      app.append(header);
      const content = create('div', 'results-content');
      if (data.job) {
        const ranking = resolveRankingStats(data);
        const stats = [[ranking.analysed,'Analysed',''],[ranking.strongMatches,'Strong matches',' ranking-stat-num--strong'],[ranking.averageScore,'Avg score /10','']];
        const statsNode = create('section', 'ranking-stats');
        stats.forEach(([value,label,modifier]) => { const stat = create('div','ranking-stat'); stat.append(create('div','ranking-stat-num' + modifier,value)); stat.append(create('div','ranking-stat-label',label)); statsNode.append(stat); });
        content.append(statsNode);
      }
      if (candidates.length) {
        const grid = create('section', 'results-grid');
        candidates.forEach((candidate,index) => grid.append(renderCandidateCard(candidate,index)));
        content.append(grid);
        const expandedIndex = candidates.findIndex((candidate,index) => getCandidateId(candidate,index) === expandedCandidateId);
        if (expandedIndex >= 0) content.append(renderCandidateDetail(candidates[expandedIndex]));
      } else content.append(create('div','empty','No candidate results are available for this analysis.'));
      const failures = Array.isArray(data.failures) ? data.failures : [];
      if (failures.length) {
        const failure = create('div','failure');
        failure.append(create('strong','',failures.length + ' resume' + (failures.length === 1 ? '' : 's') + ' could not be analysed.'));
        const names = failures.map((item) => safeText(item?.filename)).filter(Boolean).join(', ');
        if (names) failure.append(document.createTextNode(' ' + names));
        content.append(failure);
      }
      app.append(content);
      window.openai?.notifyIntrinsicHeight?.();
    };

    const renderError = () => {
      if (pollTimer) clearTimeout(pollTimer);
      app.replaceChildren();
      const error = create('div','error');
      error.append(create('p','','HireFlow could not refresh this analysis.'));
      const retry = create('button','hf-button hf-button--primary','Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => { pollAttempts = 0; refreshAnalysis(); });
      error.append(retry);
      app.append(error);
    };
    const rpcNotify = (method, params) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
    const rpcRequest = (method, params) => new Promise((resolve,reject) => { const id = ++rpcId; pendingRequests.set(id,{resolve,reject}); window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*'); });
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (typeof message.id === 'number') {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);
        if (message.error) pending.reject(message.error); else pending.resolve(message.result);
        return;
      }
      if (message.method === 'ui/notifications/tool-result') render(message.params?.structuredContent);
    }, { passive: true });
    const bridgeReady = rpcRequest('ui/initialize', { appInfo: { name: 'hireflow-analysis-results', version: '5.0.0' }, appCapabilities: { availableDisplayModes: ['inline','fullscreen'] }, protocolVersion: '2026-01-26' }).then((result) => { hostContext = result?.hostContext || {}; rpcNotify('ui/notifications/initialized',{}); return result; });
    const requestFullscreen = async () => {
      try {
        await bridgeReady;
        const availableModes = hostContext?.availableDisplayModes;
        if (Array.isArray(availableModes) && !availableModes.includes('fullscreen')) return;
        await rpcRequest('ui/request-display-mode',{mode:'fullscreen'});
      } catch (error) {
        if (window.openai?.requestDisplayMode) return window.openai.requestDisplayMode({mode:'fullscreen'});
        console.error('HireFlow fullscreen request failed:',error);
      }
    };
    const callTool = async (name,args) => { await bridgeReady; return rpcRequest('tools/call',{name,arguments:args}); };
    const refreshAnalysis = async () => {
      const analysisId = currentData?.analysisId || currentData?.id;
      if (!analysisId) return;
      try {
        const statusResponse = await callTool('get_analysis_status',{analysisId});
        const statusData = statusResponse?.structuredContent;
        if (!statusData) throw new Error('Missing status data');
        const status = safeText(statusData.status).toLowerCase();
        if (status === 'processing' || status === 'queued') { currentData = { ...currentData,status,counts:statusData.counts }; renderStatus(currentData); schedulePoll(); return; }
        const resultResponse = await callTool('render_analysis_results',{analysisId});
        if (!resultResponse?.structuredContent) throw new Error('Missing results data');
        render(resultResponse.structuredContent);
      } catch (error) { console.error('HireFlow results refresh failed:',error); renderError(); }
    };
    function schedulePoll() {
      if (pollTimer) clearTimeout(pollTimer);
      if (pollAttempts >= 120) return;
      pollTimer = setTimeout(() => { if (document.hidden) { schedulePoll(); return; } pollAttempts += 1; refreshAnalysis(); }, 5000);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && (currentData?.status === 'processing' || currentData?.status === 'queued')) refreshAnalysis(); });
    if (currentData) render(currentData);
  </script>
</body>
</html>`

export function getHireFlowAnalysisResultsWidgetResource() {
  return { uri: HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI, name: 'HireFlow analysis results', title: 'HireFlow analysis results', description: 'Interactive HireFlow candidate scores and detailed analysis.', mimeType: HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE }
}

export function readHireFlowAnalysisResultsWidgetResource() {
  return {
    contents: [{
      uri: HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI,
      mimeType: HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE,
      text: HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML,
      _meta: {
        ui: { prefersBorder: true, domain: 'https://hireflow.dev', csp: { connectDomains: [], resourceDomains: ['https://hireflow.dev'] } },
        'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
        'openai/widgetDescription': 'HireFlow results using the same ranked card and expanded analysis presentation as the HireFlow analysis page.',
        'openai/widgetPrefersBorder': true,
        'openai/widgetDomain': 'https://hireflow.dev',
        'openai/widgetCSP': { connect_domains: [], resource_domains: ['https://hireflow.dev'], redirect_domains: ['https://hireflow.dev'] },
      },
    }],
  }
}
