// ── Dashboard settings panel: history/trash plus the three chat-model ────
// pickers (LLM_MODEL, INSIGHT_LLM_MODEL, WHEN_LLM_MODEL).
//
// The history/trash keys share their choices and ranges with the desktop
// Advanced Settings window (contract 4.6, installer/src-tauri/src/settings.rs)
// — a parity test pins both. Model choices are server-driven instead: they
// come from GET /config's `modelChoices` (src/config.ts MODEL_CHOICES). A
// member sees the same effective values, read-only; admin status reuses
// team.js's existing GET /team/members probe (teamIsAdmin) rather than asking
// a second time.

// The three chat-model settings. Choices are NOT pinned here: they come from
// the Worker's GET /config `modelChoices` (src/config.ts MODEL_CHOICES), so
// the panel can never drift from the Worker's list.
const MODEL_KEYS = ['LLM_MODEL', 'INSIGHT_LLM_MODEL', 'WHEN_LLM_MODEL'];

const SETTINGS_CHOICES = {
  TRASH_RETENTION_DAYS: [7, 14, 30, 90],
  VERSION_KEEP: [10, 20, 50],
};

/** Per-key choices as last loaded. Model keys are filled from GET /config's
 * `modelChoices`; falling back to the shipped default keeps a render alive
 * even before the first load (or if the Worker predates modelChoices). */
const settingsChoices = {};
const choicesFor = (key) => settingsChoices[key] || SETTINGS_CHOICES[key] || [SETTINGS_DEFAULT[key]];

/** Must equal the Worker's shipped DEFAULTS (src/config.ts) — what Reset goes back to. */
const SETTINGS_DEFAULT = {
  TRASH_RETENTION_DAYS: 14,
  VERSION_KEEP: 20,
  LLM_MODEL: '@cf/meta/llama-4-scout-17b-16e-instruct',
  INSIGHT_LLM_MODEL: '@cf/openai/gpt-oss-120b',
  WHEN_LLM_MODEL: '@cf/openai/gpt-oss-120b',
};

const SETTINGS_SELECT_ID = {
  TRASH_RETENTION_DAYS: 'setting-trash-retention',
  VERSION_KEEP: 'setting-version-keep',
  LLM_MODEL: 'setting-llm-model',
  INSIGHT_LLM_MODEL: 'setting-insight-llm-model',
  WHEN_LLM_MODEL: 'setting-when-llm-model',
};

const SETTINGS_RESET_BTN_ID = {
  TRASH_RETENTION_DAYS: 'setting-trash-retention-reset',
  VERSION_KEEP: 'setting-version-keep-reset',
  LLM_MODEL: 'setting-llm-model-reset',
  INSIGHT_LLM_MODEL: 'setting-insight-llm-model-reset',
  WHEN_LLM_MODEL: 'setting-when-llm-model-reset',
};

const SETTINGS_ERROR_ID = {
  TRASH_RETENTION_DAYS: 'setting-trash-retention-error',
  VERSION_KEEP: 'setting-version-keep-error',
  LLM_MODEL: 'setting-llm-model-error',
  INSIGHT_LLM_MODEL: 'setting-insight-llm-model-error',
  WHEN_LLM_MODEL: 'setting-when-llm-model-error',
};

/** A failed save reads right next to the control it failed on, not in a
 * toast the reader may have already looked away from. Cleared on the
 * control's next successful write. */
function showSettingError(key, message) {
  const el = document.getElementById(SETTINGS_ERROR_ID[key]);
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function clearSettingError(key) {
  const el = document.getElementById(SETTINGS_ERROR_ID[key]);
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

/** Same formatter each select was rendered with, so a rollback or an Undo
 * reconstructs the option text and not just the selected value. */
const SETTINGS_LABEL = { TRASH_RETENTION_DAYS: retentionDaysLabel, VERSION_KEEP: undefined };

/** Reset is an admin-only affordance, and only means something once the
 * effective value has actually left the shipped default. */
function updateResetVisibility(key, value) {
  const btn = document.getElementById(SETTINGS_RESET_BTN_ID[key]);
  if (!btn) return;
  btn.hidden = teamIsAdmin === false || value === SETTINGS_DEFAULT[key];
}

function applySettingsRole(admin) {
  const note = document.getElementById('settings-admin-note');
  if (note) note.hidden = admin;
  for (const key of Object.keys(SETTINGS_SELECT_ID)) {
    const sel = document.getElementById(SETTINGS_SELECT_ID[key]);
    if (sel) sel.disabled = !admin;
    updateResetVisibility(key, settingsCurrent[key]);
  }
}

async function loadSettingsPanel() {
  try {
    const data = await readTeamConfig();
    const cfg = data?.config || {};
    settingsCurrent.TRASH_RETENTION_DAYS = cfg.TRASH_RETENTION_DAYS;
    settingsCurrent.VERSION_KEEP = cfg.VERSION_KEEP;
    for (const key of MODEL_KEYS) {
      settingsCurrent[key] = cfg[key] ?? SETTINGS_DEFAULT[key];
      settingsChoices[key] = Array.isArray(data?.modelChoices?.[key]) ? data.modelChoices[key] : undefined;
      renderSettingsOptions(SETTINGS_SELECT_ID[key], choicesFor(key), settingsCurrent[key]);
      clearSettingError(key);
    }
    renderSettingsOptions('setting-trash-retention', SETTINGS_CHOICES.TRASH_RETENTION_DAYS, cfg.TRASH_RETENTION_DAYS, retentionDaysLabel);
    renderSettingsOptions('setting-version-keep', SETTINGS_CHOICES.VERSION_KEEP, cfg.VERSION_KEEP);
    clearSettingError('TRASH_RETENTION_DAYS');
    clearSettingError('VERSION_KEEP');
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
  const value = /^-?\d+(\.\d+)?$/.test(sel.value) ? Number(sel.value) : sel.value;
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
          renderSettingsOptions(selectId, choicesFor(key), previous, SETTINGS_LABEL[key]);
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
    renderSettingsOptions(selectId, choicesFor(key), previous, SETTINGS_LABEL[key]);
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
  const selectId = SETTINGS_SELECT_ID[key];
  try {
    await requestConfig(`${WORKER_URL}/config/${key}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    settingsCurrent[key] = SETTINGS_DEFAULT[key];
    renderSettingsOptions(selectId, choicesFor(key), SETTINGS_DEFAULT[key], SETTINGS_LABEL[key]);
    updateResetVisibility(key, SETTINGS_DEFAULT[key]);
    clearSettingError(key);
    showToast(t('settingsPanel.wasReset'));
  } catch (e) {
    if (e.status === 403) applySettingsRole(false);
    else showSettingError(key, e.message);
  }
}
