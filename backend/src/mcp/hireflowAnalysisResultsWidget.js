export const HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI = 'ui://hireflow/analysis-results-v1.html'
export const HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app'

export const HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HireFlow analysis results</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--font-sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --hf-bg: var(--color-background-secondary, light-dark(#f7f9fc, #07111f));
      --hf-surface: var(--color-background-primary, light-dark(#ffffff, #0f1c2e));
      --hf-surface-soft: light-dark(#f1f5f9, #14243a);
      --hf-border: var(--color-border-primary, light-dark(#dce4ee, #2a3b51));
      --hf-text: var(--color-text-primary, light-dark(#112033, #f5f8fc));
      --hf-muted: var(--color-text-secondary, light-dark(#5c6b7c, #a7b5c6));
      --hf-mint: #63dfb7;
      --hf-mint-dark: #08775c;
      --hf-amber: #f4b740;
      --hf-red: #f06d6d;
      --hf-shadow: 0 14px 36px rgba(10, 24, 43, 0.12);
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: transparent; color: var(--hf-text); }
    body { padding: 2px; }
    button, a { font: inherit; }
    button:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid rgba(99, 223, 183, 0.45); outline-offset: 2px; }

    .shell {
      overflow: hidden;
      border: 1px solid var(--hf-border);
      border-radius: 18px;
      background: var(--hf-surface);
      box-shadow: var(--hf-shadow);
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 20px;
      border-bottom: 1px solid var(--hf-border);
      background: linear-gradient(135deg, rgba(99, 223, 183, 0.13), transparent 55%);
    }

    .eyebrow { margin: 0 0 5px; color: var(--hf-mint-dark); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(20px, 4vw, 28px); line-height: 1.15; }
    .subhead { margin: 7px 0 0; color: var(--hf-muted); font-size: 14px; }
    .header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }

    .button {
      min-height: 38px;
      border: 1px solid var(--hf-border);
      border-radius: 10px;
      padding: 8px 12px;
      background: var(--hf-surface);
      color: var(--hf-text);
      cursor: pointer;
      font-weight: 700;
      text-decoration: none;
    }
    .button:hover { border-color: var(--hf-mint); }
    .button--primary { border-color: var(--hf-mint); background: var(--hf-mint); color: #06261e; }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      border-bottom: 1px solid var(--hf-border);
      background: var(--hf-border);
    }
    .metric { padding: 14px 16px; background: var(--hf-surface); }
    .metric-value { display: block; font-size: 20px; font-weight: 850; }
    .metric-label { display: block; margin-top: 2px; color: var(--hf-muted); font-size: 12px; }

    .status-wrap { padding: 22px 20px; }
    .status-row { display: flex; align-items: center; gap: 12px; }
    .spinner { width: 20px; height: 20px; border: 3px solid var(--hf-border); border-top-color: var(--hf-mint); border-radius: 999px; animation: spin .9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status-title { margin: 0; font-size: 16px; }
    .status-copy { margin: 4px 0 0; color: var(--hf-muted); font-size: 13px; }
    .progress { height: 8px; margin-top: 16px; overflow: hidden; border-radius: 999px; background: var(--hf-surface-soft); }
    .progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--hf-mint-dark), var(--hf-mint)); transition: width .25s ease; }

    .candidate-list { display: grid; gap: 12px; padding: 16px; }
    .candidate {
      overflow: hidden;
      border: 1px solid var(--hf-border);
      border-radius: 14px;
      background: var(--hf-surface);
    }
    .candidate[open] { border-color: rgba(99, 223, 183, .75); }
    .candidate-summary { list-style: none; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 14px; cursor: pointer; }
    .candidate-summary::-webkit-details-marker { display: none; }
    .rank { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 9px; background: var(--hf-surface-soft); color: var(--hf-muted); font-size: 12px; font-weight: 800; }
    .identity { min-width: 0; }
    .name { overflow: hidden; font-size: 15px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
    .meta { overflow: hidden; margin-top: 3px; color: var(--hf-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .score { min-width: 74px; text-align: right; }
    .score-value { font-size: 20px; font-weight: 900; }
    .score-denom { color: var(--hf-muted); font-size: 12px; font-weight: 700; }
    .verdict { margin-top: 2px; font-size: 11px; font-weight: 800; }
    .verdict--strong { color: var(--hf-mint-dark); }
    .verdict--possible { color: #a66a00; }
    .verdict--low { color: #b43a3a; }
    .chevron { width: 20px; color: var(--hf-muted); transition: transform .2s ease; }
    .candidate[open] .chevron { transform: rotate(180deg); }

    .details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0 14px 14px; border-top: 1px solid var(--hf-border); }
    .panel { min-width: 0; margin-top: 14px; padding: 13px; border-radius: 12px; background: var(--hf-surface-soft); }
    .panel--wide { grid-column: 1 / -1; }
    .panel h2 { margin: 0 0 8px; font-size: 13px; }
    .panel p { margin: 0; color: var(--hf-muted); font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
    .facts { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip { max-width: 100%; border: 1px solid var(--hf-border); border-radius: 999px; padding: 5px 8px; background: var(--hf-surface); font-size: 11px; overflow-wrap: anywhere; }
    .list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
    .list li { position: relative; padding-left: 16px; color: var(--hf-muted); font-size: 12px; line-height: 1.45; }
    .list li::before { content: ""; position: absolute; left: 1px; top: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--hf-mint); }
    .panel--warning .list li::before { background: var(--hf-amber); }
    .breakdown { display: grid; gap: 7px; }
    .breakdown-row { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 1.4fr); gap: 10px; font-size: 12px; }
    .breakdown-row span:last-child { color: var(--hf-muted); text-align: right; overflow-wrap: anywhere; }
    .empty { padding: 24px 18px; color: var(--hf-muted); text-align: center; }
    .failure { margin: 0 16px 16px; padding: 12px; border: 1px solid rgba(240, 109, 109, .4); border-radius: 12px; color: var(--hf-muted); font-size: 12px; }
    .error { padding: 22px 18px; text-align: center; }
    .error p { color: var(--hf-muted); }

    @media (max-width: 680px) {
      .header { flex-direction: column; }
      .header-actions { justify-content: flex-start; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .candidate-summary { grid-template-columns: auto minmax(0, 1fr) auto; }
      .chevron { display: none; }
      .details { grid-template-columns: 1fr; }
      .panel--wide { grid-column: auto; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main class="shell" id="app" aria-live="polite">
    <div class="status-wrap"><div class="status-row"><div class="spinner" aria-hidden="true"></div><div><p class="status-title">Loading HireFlow results…</p><p class="status-copy">Retrieving the authoritative analysis.</p></div></div></div>
  </main>

  <script type="module">
    const app = document.querySelector('#app');
    let currentData = window.openai?.toolOutput || null;
    let pollTimer = null;
    let pollAttempts = 0;
    let rpcId = 0;
    let hostContext = {};
    const pendingRequests = new Map();
    const initialExpanded = window.openai?.widgetState?.privateContent?.expandedCandidateIds;
    const expandedCandidateIds = new Set(Array.isArray(initialExpanded) ? initialExpanded : []);

    const create = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined && text !== null) element.textContent = String(text);
      return element;
    };

    const appendTextList = (panel, items) => {
      const normalized = Array.isArray(items) ? items.filter(Boolean) : [];
      if (!normalized.length) {
        panel.append(create('p', '', 'Not available for this analysis.'));
        return;
      }
      const list = create('ul', 'list');
      normalized.forEach((item) => list.append(create('li', '', item)));
      panel.append(list);
    };

    const panel = (title, { wide = false, warning = false } = {}) => {
      const element = create('section', ['panel', wide ? 'panel--wide' : '', warning ? 'panel--warning' : ''].filter(Boolean).join(' '));
      element.append(create('h2', '', title));
      return element;
    };

    const scoreTone = (score) => {
      const numeric = Number(score);
      if (!Number.isFinite(numeric)) return 'low';
      if (numeric >= 8) return 'strong';
      if (numeric >= 6) return 'possible';
      return 'low';
    };

    const verdictLabel = (candidate) => {
      const explicit = String(candidate?.verdict || '').replace(/[_-]+/g, ' ').trim();
      if (explicit) return explicit.replace(/\\b\\w/g, (letter) => letter.toUpperCase());
      const rawScore = candidate?.scoreOutOfTen;
      const score = rawScore === null || rawScore === undefined || rawScore === '' ? Number.NaN : Number(rawScore);
      if (!Number.isFinite(score)) return 'Not scored';
      if (score >= 8) return 'Strong match';
      if (score >= 6) return 'Possible match';
      return 'Low match';
    };

    const saveUiState = () => {
      window.openai?.setWidgetState?.({
        modelContent: 'Viewing HireFlow analysis results.',
        privateContent: { expandedCandidateIds: [...expandedCandidateIds] },
      });
    };

    const openHireFlow = async (url) => {
      if (!url) return;
      if (window.openai?.openExternal) {
        await window.openai.openExternal({ href: url, redirectUrl: false });
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    const renderCandidate = (candidate, index) => {
      const candidateId = String(candidate?.id || candidate?.resumeId || index);
      const details = create('details', 'candidate');
      details.open = expandedCandidateIds.has(candidateId);
      details.addEventListener('toggle', () => {
        if (details.open) expandedCandidateIds.add(candidateId);
        else expandedCandidateIds.delete(candidateId);
        saveUiState();
        window.openai?.notifyIntrinsicHeight?.();
      });

      const summary = create('summary', 'candidate-summary');
      summary.append(create('span', 'rank', '#' + (index + 1)));
      const identity = create('span', 'identity');
      identity.append(create('span', 'name', candidate?.name || 'Candidate'));
      const facts = [candidate?.title, candidate?.location, candidate?.filename].filter(Boolean).join(' · ');
      identity.append(create('span', 'meta', facts || 'Candidate details'));
      summary.append(identity);

      const score = create('span', 'score');
      const rawScore = candidate?.scoreOutOfTen;
      const scoreValue = rawScore === null || rawScore === undefined || rawScore === '' ? Number.NaN : Number(rawScore);
      score.append(create('span', 'score-value', Number.isFinite(scoreValue) ? scoreValue.toFixed(1) : '—'));
      if (Number.isFinite(scoreValue)) score.append(create('span', 'score-denom', '/10'));
      const tone = scoreTone(scoreValue);
      score.append(create('span', 'verdict verdict--' + tone, verdictLabel(candidate)));
      summary.append(score);
      summary.append(create('span', 'chevron', '⌄'));
      details.append(summary);

      const body = create('div', 'details');
      const overview = panel('Summary', { wide: true });
      overview.append(create('p', '', candidate?.summary || candidate?.reason || 'Summary not available.'));
      body.append(overview);

      const profile = panel('Candidate profile');
      const profileFacts = create('div', 'facts');
      const factsToShow = [
        candidate?.email,
        candidate?.phone,
        candidate?.yearsExperience == null ? null : candidate.yearsExperience + ' years experience',
        candidate?.seniorityLevel,
      ].filter(Boolean);
      if (factsToShow.length) factsToShow.forEach((fact) => profileFacts.append(create('span', 'chip', fact)));
      else profileFacts.append(create('p', '', 'Profile facts not available.'));
      profile.append(profileFacts);
      body.append(profile);

      const skills = panel('Skills');
      const chips = create('div', 'facts');
      const skillItems = Array.isArray(candidate?.skills) ? candidate.skills : [];
      if (skillItems.length) skillItems.forEach((skill) => chips.append(create('span', 'chip', skill)));
      else chips.append(create('p', '', 'Skills not available.'));
      skills.append(chips);
      body.append(skills);

      const reasoning = panel('HireFlow reasoning', { wide: true });
      reasoning.append(create('p', '', candidate?.reason || 'Reasoning not available.'));
      body.append(reasoning);

      const recommendation = panel('Recommended action', { wide: true });
      recommendation.append(create('p', '', candidate?.recommendation || 'Recommendation not available.'));
      body.append(recommendation);

      const strengths = panel('Strengths');
      appendTextList(strengths, candidate?.strengths);
      body.append(strengths);

      const considerations = panel('Considerations', { warning: true });
      appendTextList(considerations, candidate?.considerations);
      body.append(considerations);

      const matched = panel('Matched requirements');
      appendTextList(matched, candidate?.matchedRequirements);
      body.append(matched);

      const gaps = panel('Missing requirements', { warning: true });
      appendTextList(gaps, candidate?.missingRequirements);
      body.append(gaps);

      const risks = panel('Risks or gaps', { warning: true });
      appendTextList(risks, candidate?.risksOrGaps);
      body.append(risks);

      const breakdown = panel('Score breakdown');
      const breakdownRows = create('div', 'breakdown');
      const breakdownItems = Array.isArray(candidate?.breakdown) ? candidate.breakdown : [];
      if (breakdownItems.length) {
        breakdownItems.forEach((item) => {
          const row = create('div', 'breakdown-row');
          row.append(create('span', '', item?.label || item?.key || 'Detail'));
          row.append(create('span', '', item?.value || '—'));
          breakdownRows.append(row);
        });
      } else {
        breakdownRows.append(create('p', '', 'Score breakdown not available.'));
      }
      breakdown.append(breakdownRows);
      body.append(breakdown);

      details.append(body);
      return details;
    };

    const renderStatus = (data) => {
      const counts = data?.counts || {};
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
      const status = String(data.status || '').toLowerCase();
      if (status === 'processing' || status === 'queued') {
        renderStatus(data);
        schedulePoll();
        return;
      }

      if (pollTimer) clearTimeout(pollTimer);
      app.replaceChildren();
      const header = create('header', 'header');
      const heading = create('div');
      heading.append(create('p', 'eyebrow', 'HireFlow analysis'));
      heading.append(create('h1', '', data.name || 'Analysis results'));
      heading.append(create('p', 'subhead', data?.job?.title || 'Resume-only analysis'));
      header.append(heading);

      const actions = create('div', 'header-actions');
      const fullscreen = create('button', 'button', 'Fullscreen');
      fullscreen.type = 'button';
      fullscreen.addEventListener('click', requestFullscreen);
      actions.append(fullscreen);
      if (data.url) {
        const open = create('button', 'button button--primary', 'Open in HireFlow');
        open.type = 'button';
        open.addEventListener('click', () => openHireFlow(data.url));
        actions.append(open);
        window.openai?.setOpenInAppUrl?.({ href: data.url });
      }
      header.append(actions);
      app.append(header);

      const counts = data.counts || {};
      const metrics = [
        [counts.total || 0, 'Resumes'],
        [counts.complete || 0, 'Analysed'],
        [Array.isArray(data.candidates) ? data.candidates.length : 0, 'Candidates'],
        [counts.failed || 0, 'Failed'],
      ];
      const summary = create('section', 'summary-grid');
      metrics.forEach(([value, label]) => {
        const metric = create('div', 'metric');
        metric.append(create('span', 'metric-value', value));
        metric.append(create('span', 'metric-label', label));
        summary.append(metric);
      });
      app.append(summary);

      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      if (candidates.length) {
        const list = create('section', 'candidate-list');
        candidates.forEach((candidate, index) => list.append(renderCandidate(candidate, index)));
        app.append(list);
      } else {
        app.append(create('div', 'empty', 'No candidate results are available for this analysis.'));
      }

      const failures = Array.isArray(data.failures) ? data.failures : [];
      if (failures.length) {
        const failure = create('div', 'failure');
        failure.append(create('strong', '', failures.length + ' resume' + (failures.length === 1 ? '' : 's') + ' could not be analysed.'));
        const names = failures.map((item) => item?.filename).filter(Boolean).join(', ');
        if (names) failure.append(document.createTextNode(' ' + names));
        app.append(failure);
      }
      window.openai?.notifyIntrinsicHeight?.();
    };

    const renderError = () => {
      if (pollTimer) clearTimeout(pollTimer);
      app.replaceChildren();
      const error = create('div', 'error');
      error.append(create('h1', '', 'Results could not be refreshed'));
      error.append(create('p', '', 'Open the analysis in HireFlow or try refreshing again.'));
      const retry = create('button', 'button button--primary', 'Refresh results');
      retry.type = 'button';
      retry.addEventListener('click', () => { pollAttempts = 0; refreshAnalysis(); });
      error.append(retry);
      app.append(error);
    };

    const rpcNotify = (method, params) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
    const rpcRequest = (method, params) => new Promise((resolve, reject) => {
      const id = ++rpcId;
      pendingRequests.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });

    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (typeof message.id === 'number') {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);
        if (message.error) pending.reject(message.error);
        else pending.resolve(message.result);
        return;
      }
      if (message.method === 'ui/notifications/tool-result') render(message.params?.structuredContent);
    }, { passive: true });

    const bridgeReady = rpcRequest('ui/initialize', {
      appInfo: { name: 'hireflow-analysis-results', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
      protocolVersion: '2026-01-26',
    }).then((result) => {
      hostContext = result?.hostContext || {};
      rpcNotify('ui/notifications/initialized', {});
      return result;
    });

    const requestFullscreen = async () => {
      try {
        await bridgeReady;
        const availableModes = hostContext?.availableDisplayModes;
        if (Array.isArray(availableModes) && !availableModes.includes('fullscreen')) return;
        await rpcRequest('ui/request-display-mode', { mode: 'fullscreen' });
      } catch (error) {
        if (window.openai?.requestDisplayMode) {
          await window.openai.requestDisplayMode({ mode: 'fullscreen' });
          return;
        }
        console.error('HireFlow fullscreen request failed:', error);
      }
    };

    const callTool = async (name, args) => {
      await bridgeReady;
      return rpcRequest('tools/call', { name, arguments: args });
    };

    const refreshAnalysis = async () => {
      const analysisId = currentData?.analysisId || currentData?.id;
      if (!analysisId) return;
      try {
        const statusResponse = await callTool('get_analysis_status', { analysisId });
        const statusData = statusResponse?.structuredContent;
        if (!statusData) throw new Error('Missing status data');
        const status = String(statusData.status || '').toLowerCase();
        if (status === 'processing' || status === 'queued') {
          currentData = { ...currentData, status, counts: statusData.counts };
          renderStatus(currentData);
          schedulePoll();
          return;
        }
        const resultResponse = await callTool('render_analysis_results', { analysisId });
        if (!resultResponse?.structuredContent) throw new Error('Missing results data');
        render(resultResponse.structuredContent);
      } catch (error) {
        console.error('HireFlow results refresh failed:', error);
        renderError();
      }
    };

    function schedulePoll() {
      if (pollTimer) clearTimeout(pollTimer);
      if (pollAttempts >= 120) return;
      pollTimer = setTimeout(() => {
        if (document.hidden) {
          schedulePoll();
          return;
        }
        pollAttempts += 1;
        refreshAnalysis();
      }, 5000);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (currentData?.status === 'processing' || currentData?.status === 'queued')) refreshAnalysis();
    });

    if (currentData) render(currentData);
  </script>
</body>
</html>`

export function getHireFlowAnalysisResultsWidgetResource() {
  return {
    uri: HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI,
    name: 'HireFlow analysis results',
    title: 'HireFlow analysis results',
    description: 'Interactive HireFlow candidate scores and detailed analysis.',
    mimeType: HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE,
  }
}

export function readHireFlowAnalysisResultsWidgetResource() {
  return {
    contents: [{
      uri: HIREFLOW_ANALYSIS_RESULTS_WIDGET_URI,
      mimeType: HIREFLOW_ANALYSIS_RESULTS_WIDGET_MIME_TYPE,
      text: HIREFLOW_ANALYSIS_RESULTS_WIDGET_HTML,
      _meta: {
        ui: {
          prefersBorder: true,
          domain: 'https://hireflow.dev',
          csp: { connectDomains: [], resourceDomains: [] },
        },
        'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
        'openai/widgetDescription': 'Interactive HireFlow results showing ranked candidate scores with expandable, HireFlow-generated analysis details.',
        'openai/widgetPrefersBorder': true,
        'openai/widgetDomain': 'https://hireflow.dev',
        'openai/widgetCSP': {
          connect_domains: [],
          resource_domains: [],
          redirect_domains: ['https://hireflow.dev'],
        },
      },
    }],
  }
}
