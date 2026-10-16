// ── Dashboard settings panel: history/trash plus the three chat-model ────
// pickers (LLM_MODEL, INSIGHT_LLM_MODEL, WHEN_LLM_MODEL).
//
// One SETTINGS table drives all five rows. Each entry carries its select's
// DOM id (public/index.html pins it; the reset button's and error slot's ids
// follow the same id + '-reset' / '-error' convention and are derived below),
// the shipped default Reset goes back to (must equal the Worker's DEFAULTS,
// src/config.ts), the `kind` of value PATCH sends (number or string), where
// the choices come from, and the option-label formatter.
//
// The history/trash keys share their choices and ranges with the desktop
// Advanced Settings window (contract 4.6, installer/src-tauri/src/settings.rs)
// — a parity test pins both, so their fixed `choices` live here. The model
// keys are server-driven instead: `serverChoices: true` fills the select from
// GET /config's `modelChoices` (src/config.ts MODEL_CHOICES), so the panel
// can never drift from the Worker's list. A member sees the same effective
// values, read-only; admin status reuses team.js's existing GET /team/members
// probe (teamIsAdmin) rather than asking a second time.
const SETTINGS = {
  TRASH_RETENTION_DAYS: {
    selectId: 'setting-trash-retention',
    default: 14,
    kind: 'number',
    choices: [7, 14, 30, 90],
    // Same formatter the select was rendered with, so a rollback or an Undo
    // reconstructs the option text and not just the selected value.
    label: retentionDaysLabel,
  },
  VERSION_KEEP: {
    selectId: 'setting-version-keep',
    default: 20,
    kind: 'number',
    choices: [10, 20, 50],
  },
  LLM_MODEL: {
    selectId: 'setting-llm-model',
    default: '@cf/meta/llama-4-scout-17b-16e-instruct',
    kind: 'string',
    serverChoices: true,
  },
  INSIGHT_LLM_MODEL: {
    selectId: 'setting-insight-llm-model',
    default: '@cf/openai/gpt-oss-120b',
    kind: 'string',
    serverChoices: true,
  },
  WHEN_LLM_MODEL: {
    selectId: 'setting-when-llm-model',
    default: '@cf/openai/gpt-oss-120b',
    kind: 'string',
    serverChoices: true,
  },
};

/** Reset buttons and error slots follow the select id convention pinned by
 * public/index.html: `<select id> + '-reset'` and `<select id> + '-error'`. */
const resetBtnId = (key) => `${SETTINGS[key].selectId}-reset`;
const errorId = (key) => `${SETTINGS[key].selectId}-error`;

/** Per-key choices as last loaded. `serverChoices` keys are filled from GET
 * /config's `modelChoices`; falling back to the entry's fixed `choices`, and
 * then to a one-entry default list, keeps a render alive even before the
 * first load (or if the Worker predates modelChoices). */
const settingsChoices = {};
const choicesFor = (key) => settingsChoices[key] || SETTINGS[key].choices || [SETTINGS[key].default];

/** A failed save reads right next to the control it failed on, not in a
 * toast the reader may have already looked away from. Cleared on the
 * control's next successful write. */
function showSettingError(key, message) {
  const el = document.getElementById(errorId(key));
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function clearSettingError(key) {
  const el = document.getElementById(errorId(key));
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

/** The effective value each select currently shows, for Undo's "prior value". */
const settingsCurrent = {};

function openSettingsSheet() {
  closeMenu();
  document.getElementById('settings-sheet').classList.add('open');
  loadSettingsPanel();
}

function closeSettingsSheet() {
  document.getElementById('settings-sheet').classList.remove('open');
}

/**
 * Rebuild one select's options from the given choices, plus a "Custom
 * (value)" entry when the effective value sits outside them: added, never
 * silently rewritten to the nearest choice. `formatLabel` defaults to the
 * bare value (versions kept, model ids); the retention select passes one that
 * pluralizes "day", and Custom's own {value} goes through the same formatter
 * so it reads "Custom (21 days)", not a bare "21".
 */
function renderSettingsOptions(selectId, choices, value, formatLabel) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const label = formatLabel || ((c) => String(c));
  const options = choices.map((c) => `<option value="${escHtml(String(c))}">${escHtml(label(c))}</option>`);
  if (value != null && !choices.includes(value)) {
    options.push(`<option value="${escHtml(String(value))}">${escHtml(t('settingsPanel.custom', { value: label(value) }))}</option>`);
  }
  sel.innerHTML = options.join('');
  if (value != null) sel.value = String(value);
}

function retentionDaysLabel(n) {
  return tPlural('settingsPanel.days', n);
}

/** Reset is an admin-only affordance, and only means something once the
 * effective value has actually left the shipped default. */
function updateResetVisibility(key, value) {
  const btn = document.getElementById(resetBtnId(key));
  if (!btn) return;
  btn.hidden = teamIsAdmin === false || value === SETTINGS[key].default;
}

function applySettingsRole(admin) {
  const note = document.getElementById('settings-admin-note');
  if (note) note.hidden = admin;
  for (const key of Object.keys(SETTINGS)) {
    const sel = document.getElementById(SETTINGS[key].selectId);
    if (sel) sel.disabled = !admin;
    updateResetVisibility(key, settingsCurrent[key]);
  }
}

async function loadSettingsPanel() {
  try {
    const data = await readTeamConfig();
    const cfg = data?.config || {};
    for (const key of Object.keys(SETTINGS)) {
      const setting = SETTINGS[key];
      settingsCurrent[key] = cfg[key] ?? setting.default;
      if (setting.serverChoices) {
        settingsChoices[key] = Array.isArray(data?.modelChoices?.[key]) ? data.modelChoices[key] : undefined;
      }
      renderSettingsOptions(setting.selectId, choicesFor(key), settingsCurrent[key], setting.label);
      clearSettingError(key);
    }
    // No visible stub until T-0089.5.5 gives the Worker a RECALL_LOG default;
    // presence in `defaults` is what turns this row on.
    const recallLogRow = document.getElementById('setting-recall-log-row');
    if (recallLogRow) recallLogRow.style.display = data?.defaults && 'RECALL_LOG' in data.defaults ? '' : 'none';
  } catch {}
  // A solo owner's GET /team/members also answers 200 (team.js's own note on
  // teamIsAdmin), so this reads the same as team.js's own admin-only rows.
  applySettingsRole(teamIsAdmin !== false);
}

/**
 * Never the server's own text standing alone (T-0101.10, copy deck section
 * 6.4): a network failure, a 5xx or an unreadable reply, and a rejected
 * value each get one plain, translated reason. 403 is not handled here -
 * its caller keeps the admin-only note instead of this error slot.
 */
function configErrorReason(res, data) {
  if (!data || res.status >= 500) return t('settingsPanel.errorServer');
  return t('settingsPanel.errorRejected');
}

async function requestConfig(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    const err = new Error(t('settingsPanel.failed', { message: t('settingsPanel.errorOffline') }));
    err.status = null;
    throw err;
  }
  if (res.status === 403) {
    const err = new Error(t('settingsPanel.adminOnly'));
    err.status = 403;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || !data || !data.ok) {
    const err = new Error(t('settingsPanel.failed', { message: configErrorReason(res, data) }));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function patchSetting(key, value) {
  await requestConfig(`${WORKER_URL}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTH_TOKEN}` },
    body: JSON.stringify({ [key]: value }),
  });
}

async function onSettingChange(selectId, key) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const previous = settingsCurrent[key];
  // Numeric settings arrive as digit strings; model ids stay strings.
  const value = SETTINGS[key].kind === 'number' ? Number(sel.value) : sel.value;
  try {
    await patchSetting(key, value);
    settingsCurrent[key] = value;
    updateResetVisibility(key, value);
    clearSettingError(key);
    showToast(t('settingsPanel.saved'), {
      action: t('team.undo'),
      onAction: async () => {
        try {
          await patchSetting(key, previous);
          settingsCurrent[key] = previous;
          renderSettingsOptions(selectId, choicesFor(key), previous, SETTINGS[key].label);
          updateResetVisibility(key, previous);
          clearSettingError(key);
        } catch (e) {
          showToast(e.message || t('team.actionFailed'));
        }
      },
    });
  } catch (e) {
    // A refused write leaves the effective value unchanged; the select goes
    // back to it rather than sitting on a value the Worker never accepted.
    renderSettingsOptions(selectId, choicesFor(key), previous, SETTINGS[key].label);
    updateResetVisibility(key, previous);
    if (e.status === 403) {
      // The role may have changed since the sheet opened: re-probe rather
      // than assume this was a stale admin flag.
      applySettingsRole(false);
    } else {
      showSettingError(key, e.message);
    }
  }
}

/**
 * Reset one key to the Worker's shipped default (DELETE /config/:key),
 * independent of the other setting: the same per-key reset the route
 * already offers admins elsewhere.
 */
async function resetSetting(key) {
  const selectId = SETTINGS[key].selectId;
  try {
    await requestConfig(`${WORKER_URL}/config/${key}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    settingsCurrent[key] = SETTINGS[key].default;
    renderSettingsOptions(selectId, choicesFor(key), SETTINGS[key].default, SETTINGS[key].label);
    updateResetVisibility(key, SETTINGS[key].default);
    clearSettingError(key);
    showToast(t('settingsPanel.wasReset'));
  } catch (e) {
    if (e.status === 403) applySettingsRole(false);
    else showSettingError(key, e.message);
  }
}
