// ==UserScript==
// @name         AILens — Complete AI Screen Assistant + Dashboard Pro
// @namespace    https://github.com/ai-screen-assistant
// @version      3.1.1
// @description  All-in-one AI screen assistant. Silent html2canvas capture with getDisplayMedia fallback. Gemini → Groq → OpenRouter → Local WebLLM fallback chain. Modern bottom bar UI with Math/Science/General modes, full chat panel, and built-in local LLM engine with RAM slider. + Built-in Dashboard Pro for key generation & cloud management.
// @author       AILens
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @connect      api.jsonbin.io
// @connect      esm.run
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  //  CONSTANTS & CONFIG
  // ════════════════════════════════════════════════════════════════
  const GEMINI_URL  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
  const GROQ_MODEL  = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const OR_URL      = 'https://openrouter.ai/api/v1/chat/completions';
  const OR_MODEL    = 'meta-llama/llama-3.1-8b-instruct:free';
  const WEBLLM_CDN  = 'https://esm.run/@mlc-ai/web-llm';

  const LOCAL_LLM_MODELS = [
    { minRam: 0.5, id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',   label: 'Qwen 0.5B' },
    { minRam: 1.0, id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',    label: 'Llama 3.2 1B' },
    { minRam: 1.5, id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',    label: 'Llama 3.2 3B' },
    { minRam: 2.5, id: 'Mistral-7B-Instruct-v0.3-q4f16_1-MLC', label: 'Mistral 7B' },
    { minRam: 5.0, id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',    label: 'Llama 3.1 8B' },
  ];

  const PROMPTS = {
    Math:    'You are an expert math tutor. Examine this screenshot and identify any math problems, equations, or calculations. Solve each one step-by-step showing all working. If no math problems exist, say "No math problems found."',
    Science: 'You are an expert science tutor covering physics, chemistry, biology, and earth science. Examine this screenshot and identify any science questions or problems. Answer them clearly with explanations. If none exist, say "No science questions found."',
    General: 'You are a helpful AI assistant. Examine this screenshot and identify any questions, problems, tasks, or things that need answering. Answer them concisely and accurately. If nothing needs answering, briefly describe what you see.',
  };

  // ════════════════════════════════════════════════════════════════
  //  STATE
  // ════════════════════════════════════════════════════════════════
  let shadow       = null;
  let panelOpen    = false;
  let chatHistory  = [];
  let isCapturing  = false;
  let llmEngine    = null;
  let llmLoading   = false;
  let llmRamGB     = parseFloat(GM_getValue('asa_local_ram', 2));

  // ════════════════════════════════════════════════════════════════
  //  CSS
  // ════════════════════════════════════════════════════════════════
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }

    /* ─── BOTTOM BAR ─── */
    #asa-bar {
      position: fixed; bottom: 0; left: 0; right: 0; height: 54px;
      background: rgba(9,9,13,0.94);
      backdrop-filter: blur(24px) saturate(200%);
      border-top: 1px solid rgba(255,255,255,0.07);
      display: flex; align-items: center; padding: 0 14px; gap: 8px;
      z-index: 2147483647;
      font-family: 'DM Sans', sans-serif;
      transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);
      box-shadow: 0 -8px 40px rgba(0,0,0,0.55);
    }
    #asa-bar.hidden { transform: translateY(100%); }

    .logo { font-size: 13px; font-weight: 700; color: #fff; letter-spacing: -0.3px; white-space: nowrap; }
    .logo em { font-style: normal; color: #7c6af7; }
    .divider { width: 1px; height: 26px; background: rgba(255,255,255,0.08); flex-shrink: 0; }

    /* capture method indicator */
    #asa-capture-mode {
      font-size: 10px; font-weight: 500; padding: 2px 7px; border-radius: 8px;
      background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.2);
      color: rgba(34,197,94,0.8); white-space: nowrap; flex-shrink: 0;
    }
    #asa-capture-mode.fallback {
      background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.25); color: rgba(245,158,11,0.85);
    }

    /* subject buttons */
    .sbtn {
      display: flex; align-items: center; gap: 5px;
      padding: 5px 13px; border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.09);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.65);
      font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 500;
      cursor: pointer; transition: all 0.18s; white-space: nowrap;
    }
    .sbtn:hover { background: rgba(124,106,247,0.15); border-color: rgba(124,106,247,0.35); color: #fff; transform: translateY(-1px); }
    .sbtn.active { background: rgba(124,106,247,0.22); border-color: #7c6af7; color: #fff; box-shadow: 0 0 14px rgba(124,106,247,0.28); }
    .sbtn.busy { opacity: 0.55; pointer-events: none; }
    .sbtn svg { width: 13px; height: 13px; flex-shrink: 0; }

    /* icon buttons */
    .ibtn {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 9px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.55); cursor: pointer; transition: all 0.18s; flex-shrink: 0;
    }
    .ibtn:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .ibtn svg { width: 15px; height: 15px; }
    .ibtn.active-panel { background: rgba(124,106,247,0.2); border-color: rgba(124,106,247,0.4); color: #a99fff; }

    /* status */
    #asa-status {
      display: flex; align-items: center; gap: 5px;
      margin-left: auto; font-size: 11px; font-weight: 500;
      color: rgba(255,255,255,0.38); white-space: nowrap; flex-shrink: 0;
    }
    .sdot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
    .sdot.warn { background: #f59e0b; }
    .sdot.err  { background: #ef4444; }
    .sdot.spin { background: none; border: 2px solid rgba(124,106,247,0.35); border-top-color: #7c6af7; animation: spin 0.65s linear infinite; }

    /* reveal tab */
    #asa-reveal {
      position: fixed; bottom: 0; right: 72px;
      background: rgba(9,9,13,0.94); backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.07); border-bottom: none;
      border-radius: 8px 8px 0 0; padding: 4px 12px;
      font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 500;
      color: rgba(255,255,255,0.4); cursor: pointer; z-index: 2147483646;
      transition: all 0.2s; display: none;
    }
    #asa-reveal.show { display: block; }
    #asa-reveal:hover { color: #fff; }

    /* ─── MAIN CHAT PANEL ─── */
    #asa-panel {
      position: fixed; bottom: 54px; right: 14px;
      width: 430px; max-height: calc(100vh - 76px);
      background: rgba(9,9,13,0.97);
      backdrop-filter: blur(28px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      display: flex; flex-direction: column;
      z-index: 2147483646; font-family: 'DM Sans', sans-serif;
      box-shadow: 0 12px 72px rgba(0,0,0,0.75);
      transform: translateY(18px) scale(0.97); opacity: 0; pointer-events: none;
      transition: all 0.22s cubic-bezier(0.4,0,0.2,1);
    }
    #asa-panel.open { transform: none; opacity: 1; pointer-events: all; }

    .ph { display: flex; align-items: center; gap: 9px; padding: 13px 15px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
    .ph h3 { flex: 1; font-size: 13.5px; font-weight: 650; color: rgba(255,255,255,0.92); }
    .engine-badge {
      font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9px;
      background: rgba(124,106,247,0.18); color: #b0a4ff;
      border: 1px solid rgba(124,106,247,0.28); letter-spacing: 0.3px;
    }
    .ph-close {
      width: 24px; height: 24px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.4); cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.18s;
    }
    .ph-close:hover { color: #fff; background: rgba(255,255,255,0.09); }
    .ph-close svg { width: 12px; height: 12px; }

    /* settings rows */
    .settings-wrap {
      display: none; flex-direction: column; gap: 6px;
      padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); flex-shrink: 0;
    }
    .settings-wrap.open { display: flex; }
    .settings-label { font-size: 10.5px; color: rgba(255,255,255,0.3); font-weight: 500; letter-spacing: 0.4px; text-transform: uppercase; }
    .key-row { display: flex; align-items: center; gap: 6px; }
    .key-row label { font-size: 11px; color: rgba(255,255,255,0.45); white-space: nowrap; min-width: 56px; }
    .key-input {
      flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09);
      border-radius: 7px; padding: 5px 9px;
      font-family: 'DM Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.75);
      outline: none; transition: border-color 0.18s;
    }
    .key-input:focus { border-color: rgba(124,106,247,0.5); }
    .save-keys-btn {
      padding: 5px 12px; border-radius: 7px;
      background: rgba(124,106,247,0.2); border: 1px solid rgba(124,106,247,0.35);
      color: #b0a4ff; font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600;
      cursor: pointer; transition: all 0.18s; white-space: nowrap;
    }
    .save-keys-btn:hover { background: rgba(124,106,247,0.35); }

    /* messages */
    #asa-msgs {
      flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 11px;
      min-height: 180px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
    }
    #asa-msgs::-webkit-scrollbar { width: 3px; }
    #asa-msgs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.09); border-radius: 2px; }

    .msg { max-width: 90%; padding: 9px 12px; border-radius: 12px; font-size: 13px; line-height: 1.58; }
    .msg-label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.45; margin-bottom: 3px; }
    .msg.user  { align-self: flex-end; background: rgba(124,106,247,0.2); border: 1px solid rgba(124,106,247,0.28); color: rgba(255,255,255,0.9); border-bottom-right-radius: 3px; }
    .msg.ai    { align-self: flex-start; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07); color: rgba(255,255,255,0.82); border-bottom-left-radius: 3px; cursor: pointer; }
    .msg.ai:hover { border-color: rgba(124,106,247,0.25); }
    .msg.sys   { align-self: center; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.18); color: rgba(245,158,11,0.78); font-size: 11.5px; border-radius: 8px; max-width: 100%; }
    .msg.err   { align-self: center; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: rgba(239,68,68,0.82); font-size: 11.5px; border-radius: 8px; max-width: 100%; }
    .msg img   { max-width: 100%; border-radius: 7px; margin-top: 7px; opacity: 0.82; display: block; }

    .thinking { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
    .thinking span { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.35); animation: bounce 1.1s infinite; }
    .thinking span:nth-child(2) { animation-delay: 0.18s; }
    .thinking span:nth-child(3) { animation-delay: 0.36s; }

    /* quick capture btn */
    #asa-quick-cap {
      margin: 0 14px 2px; padding: 7px;
      border-radius: 9px; background: rgba(124,106,247,0.08);
      border: 1px dashed rgba(124,106,247,0.28);
      color: rgba(124,106,247,0.75); font-family: 'DM Sans', sans-serif;
      font-size: 11.5px; font-weight: 500; cursor: pointer; text-align: center;
      transition: all 0.18s; flex-shrink: 0;
    }
    #asa-quick-cap:hover { background: rgba(124,106,247,0.18); color: #b0a4ff; }

    /* input */
    .input-row { display: flex; align-items: flex-end; gap: 7px; padding: 11px 14px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
    #asa-input {
      flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 9px; padding: 7px 11px;
      font-family: 'DM Sans', sans-serif; font-size: 13px; color: rgba(255,255,255,0.85);
      outline: none; resize: none; min-height: 36px; max-height: 96px; transition: border-color 0.18s;
    }
    #asa-input:focus { border-color: rgba(124,106,247,0.45); }
    #asa-input::placeholder { color: rgba(255,255,255,0.22); }
    #asa-send {
      width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px;
      background: #7c6af7; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.18s; color: #fff;
    }
    #asa-send:hover { background: #6b5ee0; transform: scale(1.06); }
    #asa-send svg { width: 14px; height: 14px; }

    /* ─── LOCAL LLM PANEL ─── */
    #llm-panel {
      position: fixed; bottom: 54px; left: 14px;
      width: 310px; background: rgba(9,9,13,0.97);
      backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.07);
      border-radius: 14px; z-index: 2147483645;
      box-shadow: 0 8px 52px rgba(0,0,0,0.65); overflow: hidden;
      transform: translateY(10px) scale(0.97); opacity: 0; pointer-events: none;
      transition: all 0.22s cubic-bezier(0.4,0,0.2,1);
    }
    #llm-panel.open { transform: none; opacity: 1; pointer-events: all; }

    .lh { display: flex; align-items: center; gap: 8px; padding: 11px 13px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .lh h4 { flex: 1; font-size: 13px; font-weight: 650; color: rgba(255,255,255,0.9); }
    .lclose { background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.38); font-size: 15px; line-height: 1; transition: color 0.18s; }
    .lclose:hover { color: rgba(255,255,255,0.8); }

    .lb { padding: 13px; display: flex; flex-direction: column; gap: 11px; }

    .model-tag { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 9px; font-size: 11px; font-weight: 600; }
    .model-tag.idle    { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09); color: rgba(255,255,255,0.35); }
    .model-tag.loading { background: rgba(124,106,247,0.12); border: 1px solid rgba(124,106,247,0.28); color: rgba(124,106,247,0.9); }
    .model-tag.ready   { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.22); color: rgba(34,197,94,0.9); }

    .sl-label { display: flex; justify-content: space-between; font-size: 11.5px; color: rgba(255,255,255,0.5); margin-bottom: 5px; }
    .sl-label span { font-family: 'DM Mono', monospace; color: #9d8fff; font-weight: 600; }
    input[type=range] {
      width: 100%; height: 3px; appearance: none;
      background: rgba(255,255,255,0.09); border-radius: 2px; outline: none; cursor: pointer;
    }
    input[type=range]::-webkit-slider-thumb {
      appearance: none; width: 13px; height: 13px; border-radius: 50%;
      background: #7c6af7; cursor: pointer; box-shadow: 0 0 0 3px rgba(124,106,247,0.22);
    }
    .ram-note { font-size: 10.5px; color: rgba(255,255,255,0.28); font-family: 'DM Mono', monospace; margin-top: 3px; }

    .prog-wrap { display: none; flex-direction: column; gap: 4px; }
    .prog-wrap.vis { display: flex; }
    .prog-bg { height: 3px; background: rgba(255,255,255,0.07); border-radius: 2px; overflow: hidden; }
    .prog-fg { height: 100%; background: linear-gradient(90deg, #7c6af7, #a78bfa); border-radius: 2px; width: 0%; transition: width 0.3s; }
    .prog-txt { font-size: 10.5px; color: rgba(255,255,255,0.32); }

    .llm-log {
      max-height: 72px; overflow-y: auto;
      background: rgba(255,255,255,0.025); border-radius: 6px;
      padding: 5px 8px; font-family: 'DM Mono', monospace;
      font-size: 9.5px; color: rgba(255,255,255,0.38);
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.07) transparent;
    }
    .llm-log p { line-height: 1.65; }

    .btn-row { display: flex; gap: 7px; }
    .llm-btn {
      flex: 1; padding: 7px 10px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.65); font-family: 'DM Sans', sans-serif;
      font-size: 11.5px; font-weight: 500; cursor: pointer; transition: all 0.18s; text-align: center;
    }
    .llm-btn:hover { background: rgba(255,255,255,0.09); color: #fff; }
    .llm-btn.pri { background: rgba(124,106,247,0.18); border-color: rgba(124,106,247,0.35); color: #b0a4ff; }
    .llm-btn.pri:hover { background: rgba(124,106,247,0.32); }
    .llm-btn:disabled { opacity: 0.35; pointer-events: none; }

    /* llm toggle tab */
    #llm-tab {
      position: fixed; bottom: 54px; left: 14px;
      background: rgba(9,9,13,0.94); backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
      padding: 5px 11px; font-family: 'DM Sans', sans-serif;
      font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.45);
      cursor: pointer; z-index: 2147483644; transition: all 0.18s;
      display: flex; align-items: center; gap: 5px;
    }
    #llm-tab:hover { color: #fff; }
    .ltdot { width: 6px; height: 6px; border-radius: 50%; background: #4b5563; }
    .ltdot.ready { background: #22c55e; }
    .ltdot.busy  { background: #f59e0b; animation: pulse 1s infinite; }

    @keyframes spin   { to { transform: rotate(360deg); } }
    @keyframes bounce { 0%,80%,100%{ transform:scale(0.65); opacity:0.35; } 40%{ transform:scale(1); opacity:1; } }
    @keyframes pulse  { 0%,100%{ opacity:1; } 50%{ opacity:0.4; } }
  `;

  // ════════════════════════════════════════════════════════════════
  //  BUILD UI
  // ════════════════════════════════════════════════════════════════
  function buildUI() {
    const host = document.createElement('div');
    host.id = 'ailens-root';
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    // ── BOTTOM BAR ──
    const bar = document.createElement('div');
    bar.id = 'asa-bar';
    bar.innerHTML = `
      <span class="logo">AI<em>Lens</em></span>
      <span id="asa-capture-mode">● silent</span>
      <div class="divider"></div>

      <button class="sbtn" data-subject="Math">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
          <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
        </svg>Math
      </button>
      <button class="sbtn" data-subject="Science">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
        </svg>Science
      </button>
      <button class="sbtn" data-subject="General">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
        </svg>General
      </button>

      <div class="divider"></div>

      <button class="ibtn" id="asa-chat-btn" title="Chat panel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </button>
      <button class="ibtn" id="asa-llm-btn" title="Local LLM engine">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          <path d="M7 8h.01M12 8h.01M17 8h.01M7 12h10"/>
        </svg>
      </button>
      <button class="ibtn" id="asa-settings-btn" title="API keys">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
      <button class="ibtn" id="asa-hide-btn" title="Hide bar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>

      <div id="asa-status"><div class="sdot"></div> Ready</div>
    `;
    shadow.appendChild(bar);

    // ── REVEAL TAB (shown when bar is hidden) ──
    const reveal = document.createElement('div');
    reveal.id = 'asa-reveal';
    reveal.textContent = '▲ AILens';
    shadow.appendChild(reveal);

    // ── CHAT PANEL ──
    const panel = document.createElement('div');
    panel.id = 'asa-panel';
    panel.innerHTML = `
      <div class="ph">
        <h3>💬 AI Chat</h3>
        <span class="engine-badge" id="asa-badge">—</span>
        <button class="ibtn" id="asa-clear-btn" title="Clear chat (Alt+K)" style="width:24px;height:24px;border-radius:6px;flex-shrink:0;margin-left:2px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
        <button class="ph-close" id="asa-panel-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="settings-wrap" id="asa-settings-wrap">
        <div class="settings-label">API Keys — Fallback: Gemini → Groq → OpenRouter → Local</div>
        <div class="key-row">
          <label>Gemini</label>
          <input class="key-input" type="password" id="key-gemini" placeholder="AIza… (aistudio.google.com — free)" />
        </div>
        <div class="key-row">
          <label>Groq</label>
          <input class="key-input" type="password" id="key-groq" placeholder="gsk_… (console.groq.com — free)" />
        </div>
        <div class="key-row">
          <label>OpenRouter</label>
          <input class="key-input" type="password" id="key-or" placeholder="sk-or-v1-… (openrouter.ai)" />
        </div>
        <div class="key-row" style="justify-content:flex-end;">
          <button class="save-keys-btn" id="asa-save-keys">Save Keys</button>
        </div>
      </div>

      <div id="asa-msgs">
        <div class="msg sys">
          <div class="msg-label">Welcome</div>
          Click Math / Science / General to silently capture &amp; analyse the page, or type below. Open ⚙ to add API keys. Shortcuts: <strong style="color:rgba(255,255,255,0.5)">Alt+A</strong> toggle bar · <strong style="color:rgba(255,255,255,0.5)">Alt+C</strong> capture · <strong style="color:rgba(255,255,255,0.5)">Alt+K</strong> clear chat.
        </div>
      </div>

      <button id="asa-quick-cap">📷  Capture current page &amp; ask AI (General)</button>

      <div class="input-row">
        <textarea id="asa-input" rows="1" placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"></textarea>
        <button id="asa-send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div id="asa-char-hint" style="font-size:10px;color:rgba(255,255,255,0.18);text-align:right;padding:0 14px 6px;font-family:'DM Sans',sans-serif;"></div>
    `;
    shadow.appendChild(panel);

    // ── LOCAL LLM TAB ──
    const llmTab = document.createElement('div');
    llmTab.id = 'llm-tab';
    llmTab.innerHTML = `<span class="ltdot" id="llm-dot"></span> Local LLM`;
    shadow.appendChild(llmTab);

    // ── LOCAL LLM PANEL ──
    const llmPanel = document.createElement('div');
    llmPanel.id = 'llm-panel';
    llmPanel.innerHTML = `
      <div class="lh">
        <h4>🧠 Local LLM Engine</h4>
        <button class="lclose" id="llm-close">✕</button>
      </div>
      <div class="lb">
        <div id="llm-tag" class="model-tag idle">⬤ Not loaded</div>

        <div>
          <div class="sl-label">RAM Budget <span id="llm-ram-val">${llmRamGB} GB</span></div>
          <input type="range" id="llm-slider" min="0.5" max="8" step="0.5" value="${llmRamGB}" />
          <div class="ram-note" id="llm-model-hint">→ ${selectLLM(llmRamGB).label}</div>
        </div>

        <div class="prog-wrap" id="llm-prog">
          <div class="prog-bg"><div class="prog-fg" id="llm-bar"></div></div>
          <div class="prog-txt" id="llm-prog-txt">—</div>
        </div>

        <div class="llm-log" id="llm-log"><p>Ready.</p></div>

        <div class="btn-row">
          <button class="llm-btn pri" id="llm-load">⬇ Load Model</button>
          <button class="llm-btn" id="llm-unload" disabled>🗑 Unload</button>
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.2);line-height:1.55;">
          First load downloads from CDN (200MB–2GB). Cached after first run. Requires Chrome 113+ with WebGPU.
        </div>
      </div>
    `;
    shadow.appendChild(llmPanel);

    bindEvents();
    loadSavedKeys();
    setCaptureMode(typeof html2canvas === 'function' ? 'silent' : 'picker');
  }

  // ════════════════════════════════════════════════════════════════
  //  EVENTS
  // ════════════════════════════════════════════════════════════════
  function bindEvents() {
    const $ = id => shadow.getElementById(id);

    shadow.querySelectorAll('.sbtn').forEach(btn =>
      btn.addEventListener('click', () => captureAndAnalyze(btn.dataset.subject, btn))
    );

    $('asa-hide-btn').addEventListener('click', () => {
      $('asa-bar').classList.add('hidden');
      $('asa-reveal').classList.add('show');
    });
    $('asa-reveal').addEventListener('click', () => {
      $('asa-bar').classList.remove('hidden');
      $('asa-reveal').classList.remove('show');
    });

    $('asa-chat-btn').addEventListener('click', () => togglePanel());
    $('asa-panel-close').addEventListener('click', () => togglePanel(false));

    $('asa-settings-btn').addEventListener('click', () => {
      togglePanel(true);
      const sw = $('asa-settings-wrap');
      sw.classList.toggle('open');
    });

    $('asa-save-keys').addEventListener('click', () => {
      const g = $('key-gemini').value.trim();
      const gr = $('key-groq').value.trim();
      const o = $('key-or').value.trim();
      if (g)  GM_setValue('asa_gemini_key', g);
      if (gr) GM_setValue('asa_groq_key', gr);
      if (o)  GM_setValue('asa_openrouter_key', o);
      addMsg('sys', '✅ Keys saved.  Chain: Gemini → Groq → OpenRouter → Local LLM');
      $('asa-settings-wrap').classList.remove('open');
    });

    $('asa-clear-btn').addEventListener('click', () => {
      const msgs = $('asa-msgs');
      msgs.innerHTML = '<div class="msg sys"><div class="msg-label">System</div>Chat cleared.</div>';
      chatHistory = [];
      setStatus('Ready', 'ok');
    });

    $('asa-send').addEventListener('click', sendChat);
    $('asa-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    $('asa-input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 96) + 'px';
      const hint = $('asa-char-hint');
      if (hint) hint.textContent = this.value.length > 0 ? `${this.value.length} chars` : '';
    });

    $('asa-msgs').addEventListener('click', e => {
      const msg = e.target.closest('.msg.ai');
      if (!msg) return;
      const text = msg.innerText.replace(/^AI\n/, '').trim();
      navigator.clipboard.writeText(text).then(() => {
        const orig = msg.style.outline;
        msg.style.outline = '1px solid rgba(124,106,247,0.5)';
        setTimeout(() => { msg.style.outline = orig; }, 600);
      });
    });

    document.addEventListener('keydown', e => {
      if (!e.altKey) return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        const bar = $('asa-bar');
        const reveal = $('asa-reveal');
        if (bar.classList.contains('hidden')) {
          bar.classList.remove('hidden'); reveal.classList.remove('show');
        } else {
          bar.classList.add('hidden'); reveal.classList.add('show');
        }
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        captureAndAnalyze('General', null);
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        const msgs = $('asa-msgs');
        msgs.innerHTML = '<div class="msg sys"><div class="msg-label">System</div>Chat cleared.</div>';
        chatHistory = [];
      }
    });

    $('asa-quick-cap').addEventListener('click', () => captureAndAnalyze('General', null));

    $('llm-tab').addEventListener('click', () => toggleLLMPanel());
    $('llm-close').addEventListener('click', () => toggleLLMPanel(false));
    $('asa-llm-btn').addEventListener('click', () => toggleLLMPanel());

    $('llm-slider').addEventListener('input', function () {
      llmRamGB = parseFloat(this.value);
      GM_setValue('asa_local_ram', llmRamGB);
      $('llm-ram-val').textContent = llmRamGB + ' GB';
      $('llm-model-hint').textContent = '→ ' + selectLLM(llmRamGB).label;
    });

    $('llm-load').addEventListener('click', loadLLM);
    $('llm-unload').addEventListener('click', unloadLLM);
  }

  function loadSavedKeys() {
    const $ = id => shadow.getElementById(id);
    const g = GM_getValue('asa_gemini_key', '');
    const gr = GM_getValue('asa_groq_key', '');
    const o = GM_getValue('asa_openrouter_key', '');
    if (g)  $('key-gemini').value = g;
    if (gr) $('key-groq').value   = gr;
    if (o)  $('key-or').value     = o;
  }

  function togglePanel(force) {
    panelOpen = force !== undefined ? force : !panelOpen;
    shadow.getElementById('asa-panel').classList.toggle('open', panelOpen);
    shadow.getElementById('asa-chat-btn').classList.toggle('active-panel', panelOpen);
  }

  let llmPanelOpen = false;
  function toggleLLMPanel(force) {
    llmPanelOpen = force !== undefined ? force : !llmPanelOpen;
    shadow.getElementById('llm-panel').classList.toggle('open', llmPanelOpen);
  }

  function setStatus(text, state = 'ok') {
    const el = shadow.getElementById('asa-status');
    if (!el) return;
    const cls = { ok: '', warn: 'warn', err: 'err', loading: 'spin' }[state] || '';
    el.innerHTML = `<div class="sdot ${cls}"></div> ${text}`;
  }

  function setBadge(text) {
    const el = shadow.getElementById('asa-badge');
    if (el) el.textContent = text;
  }

  function addMsg(role, content, imgUrl = null) {
    const box = shadow.getElementById('asa-msgs');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    const labels = { user: 'You', ai: 'AI', sys: 'System', err: 'Error' };
    d.innerHTML = `<div class="msg-label">${labels[role] || role}</div>${esc(content)}`;
    if (imgUrl) d.innerHTML += `<img src="${imgUrl}" alt="capture">`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    if (role === 'user') chatHistory.push({ role: 'user', content });
    if (role === 'ai')   chatHistory.push({ role: 'assistant', content });
  }

  function showThinking() {
    const box = shadow.getElementById('asa-msgs');
    const d = document.createElement('div');
    d.id = 'asa-thinking'; d.className = 'msg ai';
    d.innerHTML = `<div class="thinking"><span></span><span></span><span></span></div>`;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
  function hideThinking() {
    const el = shadow.getElementById('asa-thinking');
    if (el) el.remove();
  }

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
  }

  function setCaptureMode(mode) {
    const el = shadow.getElementById('asa-capture-mode');
    if (!el) return;
    if (mode === 'silent') {
      el.textContent = '● silent';
      el.classList.remove('fallback');
    } else {
      el.textContent = '⚠ picker';
      el.classList.add('fallback');
    }
  }

  async function captureScreen() {
    if (typeof html2canvas === 'function') {
      try {
        setCaptureMode('silent');
        const canvas = await html2canvas(document.body, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          scale: Math.min(window.devicePixelRatio || 1, 1.5),
          ignoreElements: el => el.id === 'ailens-root',
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight,
        });
        return canvas.toDataURL('image/jpeg', 0.82);
      } catch (e) {
        console.warn('[AILens] html2canvas failed, falling back to picker:', e.message);
      }
    }

    setCaptureMode('picker');
    addMsg('sys', '⚠️ Silent capture unavailable — please select your screen/tab in the picker that appears.');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never' }, audio: false });
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        setTimeout(() => {
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          stream.getTracks().forEach(t => t.stop());
          resolve(c.toDataURL('image/jpeg', 0.78));
        }, 250);
      };
      video.onerror = reject;
    });
  }

  async function captureAndAnalyze(subject, triggerBtn) {
    if (isCapturing) return;
    isCapturing = true;
    if (triggerBtn) triggerBtn.classList.add('busy', 'active');
    setStatus('Capturing…', 'loading');

    let dataUrl;
    try {
      dataUrl = await captureScreen();
    } catch (err) {
      setStatus('Capture failed', 'err');
      addMsg('err', `Capture failed: ${err.message}`);
      isCapturing = false;
      if (triggerBtn) triggerBtn.classList.remove('busy', 'active');
      return;
    }

    if (!panelOpen) togglePanel(true);
    addMsg('user', `[Screenshot — ${subject} mode]`, dataUrl);
    setStatus('Analysing…', 'loading');
    showThinking();

    try {
      const answer = await queryFallback(PROMPTS[subject] || PROMPTS.General, dataUrl.split(',')[1], 'image/jpeg');
      hideThinking();
      addMsg('ai', answer);
      setStatus('Done', 'ok');
    } catch (err) {
      hideThinking();
      addMsg('err', `All AI engines failed: ${err.message}`);
      setStatus('All failed', 'err');
    }

    isCapturing = false;
    if (triggerBtn) triggerBtn.classList.remove('busy', 'active');
  }

  async function sendChat() {
    const input = shadow.getElementById('asa-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; input.style.height = 'auto';
    addMsg('user', text);
    setStatus('Thinking…', 'loading');
    showThinking();
    try {
      const answer = await queryFallback(text, null, null);
      hideThinking(); addMsg('ai', answer); setStatus('Done', 'ok');
    } catch (err) {
      hideThinking(); addMsg('err', `All engines failed: ${err.message}`); setStatus('All failed', 'err');
    }
  }

  async function queryFallback(prompt, b64 = null, mime = null) {
    const gKey  = GM_getValue('asa_gemini_key', '');
    const grKey = GM_getValue('asa_groq_key', '');
    const orKey = GM_getValue('asa_openrouter_key', '');

    if (gKey) {
      try {
        setBadge('Gemini Flash');
        return await queryGemini(prompt, gKey, b64, mime);
      } catch (e) {
        console.warn('[AILens] Gemini:', e.message);
        addMsg('sys', `⚠️ Gemini failed (${e.message}) → trying Groq…`);
      }
    } else { addMsg('sys', '⚠️ No Gemini key → trying Groq…'); }

    if (grKey) {
      try {
        setBadge('Groq Llama4');
        return await queryGroq(prompt, grKey, b64, mime);
      } catch (e) {
        console.warn('[AILens] Groq:', e.message);
        addMsg('sys', `⚠️ Groq failed (${e.message}) → trying OpenRouter…`);
      }
    } else { addMsg('sys', '⚠️ No Groq key → trying OpenRouter…'); }

    if (orKey) {
      try {
        setBadge('OpenRouter');
        return await queryOpenRouter(prompt, orKey, b64, mime);
      } catch (e) {
        console.warn('[AILens] OpenRouter:', e.message);
        addMsg('sys', `⚠️ OpenRouter failed (${e.message}) → trying Local LLM…`);
      }
    } else { addMsg('sys', '⚠️ No OpenRouter key → trying Local LLM…'); }

    try {
      setBadge('Local LLM');
      return await runLocalLLM(prompt, b64);
    } catch (e) {
      throw new Error(`Local LLM: ${e.message}`);
    }
  }

  async function queryGemini(prompt, key, b64, mime) {
    const parts = [{ text: prompt }];
    if (b64) parts.unshift({ inline_data: { mime_type: mime || 'image/jpeg', data: b64 } });
    return gmPost(
      `${GEMINI_URL}?key=${key}`,
      { 'Content-Type': 'application/json' },
      { contents: [{ parts }] },
      30000,
      d => {
        if (d.error) throw new Error(d.error.message);
        const t = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!t) throw new Error('Empty response');
        return t;
      }
    );
  }

  async function queryGroq(prompt, key, b64, mime) {
    const userContent = b64
      ? [{ type: 'image_url', image_url: { url: `data:${mime||'image/jpeg'};base64,${b64}` } }, { type: 'text', text: prompt }]
      : prompt;
    const messages = [
      { role: 'system', content: 'You are a helpful AI. Identify and answer questions in screenshots accurately.' },
      ...chatHistory.slice(-4).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];
    return gmPost(
      GROQ_URL,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      { model: GROQ_MODEL, messages, max_tokens: 1500 },
      30000,
      d => {
        if (d.error) throw new Error(d.error.message);
        const t = d.choices?.[0]?.message?.content;
        if (!t) throw new Error('Empty response');
        return t;
      }
    );
  }

  async function queryOpenRouter(prompt, key, b64, mime) {
    const userContent = b64
      ? [{ type: 'image_url', image_url: { url: `data:${mime||'image/jpeg'};base64,${b64}` } }, { type: 'text', text: prompt }]
      : [{ type: 'text', text: prompt }];
    const messages = [
      ...chatHistory.slice(-6).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];
    return gmPost(
      OR_URL,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': location.origin },
      { model: OR_MODEL, messages, max_tokens: 1500 },
      40000,
      d => {
        if (d.error) throw new Error(d.error.message);
        const t = d.choices?.[0]?.message?.content;
        if (!t) throw new Error('Empty response');
        return t;
      }
    );
  }

  function gmPost(url, headers, body, timeout, parser) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST', url, headers,
        data: JSON.stringify(body),
        timeout,
        onload(r) {
          try { resolve(parser(JSON.parse(r.responseText))); }
          catch (e) { reject(e); }
        },
        onerror()  { reject(new Error('Network error')); },
        ontimeout() { reject(new Error('Timeout')); },
      });
    });
  }

  function selectLLM(gb) {
    let m = LOCAL_LLM_MODELS[0];
    for (const x of LOCAL_LLM_MODELS) { if (gb >= x.minRam) m = x; }
    return m;
  }

  function llmLog(msg) {
    const el = shadow.getElementById('llm-log');
    if (!el) return;
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(p); el.scrollTop = el.scrollHeight;
  }

  function setLLMProgress(pct, text) {
    const w = shadow.getElementById('llm-prog');
    const b = shadow.getElementById('llm-bar');
    const t = shadow.getElementById('llm-prog-txt');
    if (!w) return;
    w.classList.toggle('vis', pct < 100 || llmLoading);
    b.style.width = pct + '%';
    t.textContent = text;
  }

  function setLLMTag(text, cls) {
    const el = shadow.getElementById('llm-tag');
    if (!el) return;
    el.textContent = text;
    el.className = 'model-tag ' + cls;
  }

  function setLLMDot(state) {
    const d = shadow.getElementById('llm-dot');
    if (!d) return;
    d.className = 'ltdot' + (state === 'ready' ? ' ready' : state === 'busy' ? ' busy' : '');
  }

  async function loadLLM() {
    if (llmLoading || llmEngine) return;
    llmLoading = true;
    const model = selectLLM(llmRamGB);
    setLLMTag(`⏳ Loading ${model.label}…`, 'loading');
    setLLMDot('busy');
    toggleLLMPanel(true);
    setLLMProgress(0, `Initialising ${model.label}…`);
    llmLog(`Loading ${model.id} (≤${llmRamGB}GB RAM budget)`);
    shadow.getElementById('llm-load').disabled = true;

    try {
      llmLog('Importing WebLLM from CDN…');
      const { CreateMLCEngine } = await import(/* webpackIgnore: true */ WEBLLM_CDN);
      llmEngine = await CreateMLCEngine(model.id, {
        initProgressCallback(r) {
          const pct = Math.round((r.progress || 0) * 100);
          setLLMProgress(pct, r.text || `${pct}%`);
          if (r.text) llmLog(r.text);
        },
      });
      setLLMTag(`✅ ${model.label} ready`, 'ready');
      setLLMDot('ready');
      setLLMProgress(100, 'Model ready');
      llmLog(`✅ ${model.label} loaded.`);
      shadow.getElementById('llm-unload').disabled = false;
    } catch (err) {
      setLLMTag('❌ Failed', 'idle');
      setLLMDot('');
      llmLog(`Error: ${err.message}`);
      llmEngine = null;
    }

    llmLoading = false;
    shadow.getElementById('llm-load').disabled = false;
  }

  function unloadLLM() {
    try { llmEngine?.unload?.(); } catch (_) {}
    llmEngine = null;
    setLLMTag('⬤ Not loaded', 'idle');
    setLLMDot('');
    setLLMProgress(0, '');
    shadow.getElementById('llm-prog').classList.remove('vis');
    shadow.getElementById('llm-unload').disabled = true;
    llmLog('Model unloaded.');
  }

  async function runLocalLLM(prompt, b64) {
    if (!llmEngine) {
      llmLog('Auto-loading model…');
      await loadLLM();
      if (!llmEngine) throw new Error('Model failed to load. Open Local LLM panel and try manually.');
    }
    const messages = [
      { role: 'system', content: 'You are a helpful AI. Identify and answer questions in screenshots accurately.' },
    ];
    if (b64) {
      messages.push({ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: 'text', text: prompt },
      ]});
    } else {
      messages.push({ role: 'user', content: prompt });
    }
    llmLog('Running inference…');
    const reply = await llmEngine.chat.completions.create({ messages, max_tokens: 1024 });
    const text = reply.choices[0]?.message?.content || '(no response)';
    llmLog(`Done — ${text.length} chars.`);
    return text;
  }

  // ════════════════════════════════════════════════════════════════
  //  LICENSE KEY GATE
  // ════════════════════════════════════════════════════════════════
  const GATE_KEY  = 'ailens_activated';
  const HMAC_SALT = 'ailens_v1_integrity';
  const BIN_ID_KEY  = 'ailens_bin_id';
  const BIN_KEY_KEY = 'ailens_bin_key';

  function hashKey(k) {
    let h = 0x811c9dc5;
    for (let i = 0; i < k.length; i++) {
      h ^= k.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function loadPool() {
    return new Promise((resolve) => {
      const binId  = GM_getValue(BIN_ID_KEY,  '').trim();
      const binKey = GM_getValue(BIN_KEY_KEY, '').trim();
      if (!binId || !binKey) { resolve([]); return; }
      GM_xmlhttpRequest({
        method:  'GET',
        url:     `https://api.jsonbin.io/v3/b/${binId}/latest`,
        headers: { 'X-Master-Key': binKey, 'X-Bin-Meta': 'false' },
        timeout: 12000,
        onload(r) {
          try {
            const d = JSON.parse(r.responseText);
            resolve(Array.isArray(d) ? d : (Array.isArray(d.record) ? d.record : []));
          } catch { resolve([]); }
        },
        onerror()   { resolve([]); },
        ontimeout() { resolve([]); },
      });
    });
  }

  function savePool(pool) {
    return new Promise((resolve, reject) => {
      const binId  = GM_getValue(BIN_ID_KEY,  '').trim();
      const binKey = GM_getValue(BIN_KEY_KEY, '').trim();
      if (!binId || !binKey) { reject(new Error('Cloud storage not configured')); return; }
      GM_xmlhttpRequest({
        method:  'PUT',
        url:     `https://api.jsonbin.io/v3/b/${binId}`,
        headers: {
          'Content-Type':     'application/json',
          'X-Master-Key':     binKey,
          'X-Bin-Versioning': 'false',
        },
        data:    JSON.stringify(pool),
        timeout: 12000,
        onload(r)   { r.status === 200 ? resolve() : reject(new Error(`HTTP ${r.status}`)); },
        onerror()   { reject(new Error('Network error')); },
        ontimeout() { reject(new Error('Timeout')); },
      });
    });
  }

  async function validateAndConsume(inputKey) {
    const k = inputKey.trim();
    if (!k) return false;

    const pool = await loadPool();
    if (!pool.length) return false;

    const idx = pool.findIndex(e => e.key === k && !e.used && !e.revoked);
    if (idx === -1) return false;

    pool[idx].used   = true;
    pool[idx].usedAt = new Date().toISOString();

    try {
      await savePool(pool);
    } catch (_) {}

    GM_setValue(GATE_KEY, k);
    GM_setValue(GATE_KEY + '_hash', hashKey(k + HMAC_SALT));
    return true;
  }

  function checkActivation() {
    const saved     = GM_getValue(GATE_KEY, '');
    const savedHash = GM_getValue(GATE_KEY + '_hash', '');
    if (!saved) return false;
    return hashKey(saved + HMAC_SALT) === savedHash;
  }

  const EULA_TEXT = `AILENS END-USER LICENCE AGREEMENT (EULA)
Last updated: 2025

PLEASE READ THIS AGREEMENT CAREFULLY BEFORE ACTIVATING OR USING AILENS.
BY TICKING THE ACCEPTANCE CHECKBOX AND ENTERING AN ACTIVATION KEY YOU
CONFIRM THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY ALL
TERMS BELOW. IF YOU DO NOT AGREE, DO NOT ACTIVATE OR USE THIS SOFTWARE.

─────────────────────────────────────────────────────────────────────────

1. DEFINITIONS
   "Software" means the AILens browser script, including all associated
   files, updates, and documentation.
   "Licence Key" means the unique 10-character single-use code issued to
   you that activates the Software on one browser.
   "You" / "User" means the individual who received and activated a
   Licence Key.
   "Licensor" means the author and distributor of AILens.

2. GRANT OF LICENCE
   Subject to the terms of this Agreement, the Licensor grants you a
   limited, personal, non-exclusive, non-transferable licence to install
   and use the Software on a single browser for your own personal,
   non-commercial purposes. This licence begins upon successful activation
   with a valid Licence Key.

3. LICENCE KEY RESTRICTIONS
   Each Licence Key is single-use and may only be activated once across
   all browsers and devices. You may not:
   (a) Share, sell, transfer, or publish your Licence Key to any third party.
   (b) Use a Licence Key that was not issued directly to you.
   (c) Attempt to generate, guess, or brute-force Licence Keys.
   (d) Use any automated tool or script to activate the Software.

4. PROHIBITED ACTIONS
   You may not, under any circumstances:
   (a) Copy, redistribute, resell, sublicense, or publish the Software or
       any portion of it without prior written consent from the Licensor.
   (b) Modify, decompile, reverse-engineer, or create derivative works
       based on the Software for the purpose of circumventing its licence
       protection, activation system, or integrity checks.
   (c) Remove, alter, or disable any licence validation, activation gate,
       EULA display, or integrity verification code within the Software.
   (d) Use the Software to provide commercial services to third parties
       without a separate commercial licence from the Licensor.
   (e) Misrepresent the origin of the Software or remove author attribution.

5. INTELLECTUAL PROPERTY
   The Software and all associated intellectual property rights remain the
   exclusive property of the Licensor. This Agreement does not transfer
   any ownership rights to you. All rights not expressly granted herein
   are reserved by the Licensor.

6. PIRACY & ENFORCEMENT
   Unauthorised use, key sharing, bypassing the activation system, or
   tampering with any part of the licence protection constitutes software
   piracy and a material breach of this Agreement. Upon detection of such
   activity the Software will disable itself on the affected browser and
   display a violation notice. The Licensor reserves the right to pursue
   all available legal remedies in response to piracy.

7. THIRD-PARTY SERVICES
   The Software may send screenshot data to third-party AI APIs (Google
   Gemini, Groq, OpenRouter). By using the AI capture features you
   acknowledge and accept the privacy policies and terms of service of
   those providers. The Licensor is not responsible for the handling of
   data by third-party services.

8. DATA & PRIVACY
   The Software does not transmit any personal data to the Licensor.
   API keys you enter are stored locally in your browser only. Screenshot
   data is sent only to the AI provider you have configured and only at
   the moment you trigger a capture. No usage data, telemetry, or
   analytics are collected by the Licensor.

9. DISCLAIMER OF WARRANTIES
   THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS
   OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. THE LICENSOR
   DOES NOT WARRANT THAT THE SOFTWARE WILL BE ERROR-FREE, UNINTERRUPTED,
   OR COMPATIBLE WITH ALL WEBSITES OR BROWSER VERSIONS.

10. LIMITATION OF LIABILITY
    TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE LICENSOR SHALL
    NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
    PUNITIVE DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE THE
    SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

11. TERMINATION
    This licence is effective until terminated. It terminates automatically
    if you breach any term of this Agreement. Upon termination you must
    cease all use of the Software and destroy all copies in your possession.

12. GOVERNING LAW
    This Agreement shall be governed by and construed in accordance with
    applicable law. Any disputes arising under this Agreement shall be
    subject to the exclusive jurisdiction of the relevant courts.

13. ENTIRE AGREEMENT
    This Agreement constitutes the entire agreement between you and the
    Licensor regarding the Software and supersedes all prior agreements,
    representations, or understandings relating to the same subject matter.

14. ACCEPTANCE
    By ticking "I have read and agree to the User Policy Agreement" and
    activating the Software with a valid Licence Key, you confirm that you
    are at least 13 years of age, have read and understood this Agreement,
    and agree to be bound by its terms.

─────────────────────────────────────────────────────────────────────────
© AILens. All rights reserved.`;

  function fnHash(fn) {
    const s = fn.toString().replace(/\s+/g, ' ').trim();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function checkIntegrity() {
    try {
      const fns = [checkActivation, validateAndConsume, hashKey, loadPool, savePool];
      if (fns.some(f => typeof f !== 'function')) return false;
      const baseline = fns.map(f => fnHash(f));
      return fns.every((f, i) => fnHash(f) === baseline[i]);
    } catch (e) {
      return false;
    }
  }

  function showPiracyNotice() {
    const host = document.createElement('div');
    host.id = 'ailens-piracy-host';
    document.body.appendChild(host);
    const sh = host.attachShadow({ mode: 'open' });

    sh.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        #overlay {
          position: fixed; inset: 0; z-index: 2147483646;
          background: rgba(0,0,0,0.96);
          display: flex; align-items: center; justify-content: center;
          font-family: 'DM Sans', sans-serif;
        }
        #card {
          background: rgba(18,6,6,0.99);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 20px; padding: 44px 40px 36px;
          width: 460px; max-width: calc(100vw - 32px);
          display: flex; flex-direction: column; gap: 18px; align-items: center;
          box-shadow: 0 0 80px rgba(239,68,68,0.12), 0 24px 60px rgba(0,0,0,0.8);
          animation: pop 0.3s cubic-bezier(0.4,0,0.2,1);
          text-align: center;
        }
        @keyframes pop { from { transform: scale(0.9) translateY(16px); opacity:0; } to { transform: none; opacity:1; } }
        .icon { font-size: 48px; line-height: 1; }
        h2 { font-size: 20px; font-weight: 700; color: #f87171; letter-spacing: -0.3px; }
        p { font-size: 13.5px; color: rgba(255,255,255,0.45); line-height: 1.7; max-width: 340px; }
        .policy-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(239,68,68,0.6); font-size: 12px; font-weight: 500;
          text-decoration: underline; font-family: 'DM Sans', sans-serif;
          transition: color 0.18s;
        }
        .policy-btn:hover { color: #f87171; }
        .code {
          font-family: monospace; font-size: 11px;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.15);
          border-radius: 8px; padding: 8px 14px; color: rgba(239,68,68,0.7);
          width: 100%;
        }
        #pm-wrap {
          display: none; position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,0.82); backdrop-filter: blur(10px);
          align-items: center; justify-content: center;
        }
        #pm-wrap.open { display: flex; }
        #pm-box {
          background: rgba(10,10,16,0.99); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px; width: 500px; max-width: calc(100vw - 32px);
          max-height: 80vh; display: flex; flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.8); overflow: hidden;
        }
        .pmh { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.07);
          display: flex; align-items: center; gap: 10px; }
        .pmh h3 { flex:1; font-size: 14px; font-weight: 650; color: #fff; }
        .pmh button { width:26px; height:26px; border-radius:7px; border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.5); cursor:pointer;
          font-size:14px; transition:all 0.15s; }
        .pmh button:hover { color:#fff; background:rgba(255,255,255,0.1); }
        .pmb { flex:1; overflow-y:auto; padding:20px; scrollbar-width:thin; }
        .pmb pre { font-family:'DM Sans',sans-serif; font-size:12.5px; color:rgba(255,255,255,0.55); line-height:1.75; white-space:pre-wrap; }
        .pmf { padding:14px 20px; border-top:1px solid rgba(255,255,255,0.07);
          display:flex; align-items:center; justify-content:center; }
        .pmf span { font-size:15px; font-weight:700; color:#f87171; }
      </style>
      <div id="overlay">
        <div id="card">
          <div class="icon">🚫</div>
          <h2>Piracy Detected</h2>
          <p>You have attempted to bypass or tamper with AILens licence protection. This is against our User Policy Agreement and constitutes software piracy.</p>
          <p>AILens has been disabled on this browser.</p>
          <div class="code">Error: Integrity check failed — licence protection tampered.</div>
          <button class="policy-btn" id="piracy-policy-btn">View User Policy Agreement</button>
        </div>
      </div>
      <div id="pm-wrap">
        <div id="pm-box">
          <div class="pmh"><h3>📋 User Policy Agreement</h3><button id="pm-close">✕</button></div>
          <div class="pmb"><pre>${EULA_TEXT}</pre></div>
          <div class="pmf"><span>🚫 No Piracy</span></div>
        </div>
      </div>
    `;

    sh.getElementById('piracy-policy-btn').addEventListener('click', () => {
      sh.getElementById('pm-wrap').classList.add('open');
    });
    sh.getElementById('pm-close').addEventListener('click', () => {
      sh.getElementById('pm-wrap').classList.remove('open');
    });
    sh.getElementById('pm-wrap').addEventListener('click', e => {
      if (e.target === sh.getElementById('pm-wrap')) sh.getElementById('pm-wrap').classList.remove('open');
    });
  }

  function showKeyGate() {
    const host = document.createElement('div');
    host.id = 'ailens-gate-host';
    document.body.appendChild(host);
    const sh = host.attachShadow({ mode: 'open' });

    sh.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        #overlay {
          position: fixed; inset: 0; z-index: 2147483645;
          background: rgba(0,0,0,0.88);
          backdrop-filter: blur(18px) saturate(160%);
          display: flex; align-items: center; justify-content: center;
          font-family: 'DM Sans', sans-serif;
          transition: opacity 0.3s;
        }
        #overlay.hidden { opacity: 0; pointer-events: none; }
        #show-tab {
          position: fixed; bottom: 64px; right: 14px; z-index: 2147483645;
          background: rgba(9,9,13,0.95); backdrop-filter: blur(16px);
          border: 1px solid rgba(124,106,247,0.35); border-radius: 10px;
          padding: 7px 14px; font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 600; color: #9d8fff;
          cursor: pointer; display: none; transition: all 0.2s;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        }
        #show-tab.visible { display: block; }
        #show-tab:hover { background: rgba(124,106,247,0.2); color: #fff; }
        #card {
          background: rgba(12,12,18,0.98);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 20px; padding: 32px 32px 28px; width: 420px;
          max-width: calc(100vw - 32px);
          box-shadow: 0 24px 80px rgba(0,0,0,0.7);
          display: flex; flex-direction: column; gap: 16px;
          animation: pop 0.25s cubic-bezier(0.4,0,0.2,1);
        }
        @keyframes pop { from { transform: scale(0.93) translateY(12px); opacity:0; } to { transform: none; opacity:1; } }
        .card-header { display: flex; align-items: center; justify-content: space-between; }
        .logo { font-size: 21px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
        .logo em { font-style: normal; color: #7c6af7; }
        #hide-btn {
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09);
          border-radius: 8px; padding: 4px 11px; cursor: pointer; transition: all 0.18s;
          font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 500;
          color: rgba(255,255,255,0.4);
        }
        #hide-btn:hover { background: rgba(255,255,255,0.09); color: rgba(255,255,255,0.75); }
        p { font-size: 13px; color: rgba(255,255,255,0.42); line-height: 1.6; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field-label { font-size: 10.5px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.6px; }
        .key-wrap { position: relative; }
        #key-input {
          width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px; padding: 11px 40px 11px 14px;
          font-family: 'DM Mono', monospace; font-size: 14px;
          color: #fff; outline: none; transition: border-color 0.2s; letter-spacing: 1.5px;
        }
        #key-input:focus { border-color: rgba(124,106,247,0.6); }
        #key-input::placeholder { color: rgba(255,255,255,0.18); font-size: 12px; letter-spacing: 0.5px; }
        #toggle-vis {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.3);
          font-size: 15px; padding: 2px; transition: color 0.15s; line-height: 1;
        }
        #toggle-vis:hover { color: rgba(255,255,255,0.7); }
        .eula-row {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 9px 11px; border-radius: 10px;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
        }
        #eula-check {
          width: 15px; height: 15px; flex-shrink: 0; margin-top: 2px;
          accent-color: #7c6af7; cursor: pointer;
        }
        .eula-row label { font-size: 12px; color: rgba(255,255,255,0.42); line-height: 1.55; cursor: pointer; }
        .eula-link {
          color: #9d8fff; text-decoration: underline; cursor: pointer;
          background: none; border: none; font-size: 12px; font-family: 'DM Sans', sans-serif;
          padding: 0; transition: color 0.15s;
        }
        .eula-link:hover { color: #c4b8ff; }
        #err { font-size: 12px; color: #f87171; min-height: 15px; font-weight: 500; }
        #activate-btn {
          padding: 11px; border-radius: 11px; background: #7c6af7; border: none;
          color: #fff; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.18s;
        }
        #activate-btn:hover:not(:disabled) { background: #6b5ee0; transform: translateY(-1px); box-shadow: 0 6px 24px rgba(124,106,247,0.35); }
        #activate-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .hint { font-size: 11px; color: rgba(255,255,255,0.18); text-align: center; line-height: 1.6; }
        .hint strong { color: #9d8fff; }
        #pm-wrap, #cs-wrap {
          display: none; position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,0.82); backdrop-filter: blur(10px);
          align-items: center; justify-content: center;
        }
        #pm-wrap.open, #cs-wrap.open { display: flex; }
        #pm-box, #cs-box {
          background: rgba(10,10,16,0.99); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px; width: 500px; max-width: calc(100vw - 32px);
          max-height: 80vh; display: flex; flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.8); overflow: hidden;
        }
        .pmh { padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.07);
          display: flex; align-items: center; gap: 10px; }
        .pmh h3 { flex:1; font-size: 13.5px; font-weight: 650; color: #fff; }
        .pmh button { width:26px; height:26px; border-radius:7px; border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.5); cursor:pointer; font-size:14px; transition:all 0.15s; }
        .pmh button:hover { color:#fff; background:rgba(255,255,255,0.1); }
        .pmb { flex:1; overflow-y:auto; padding:18px; scrollbar-width:thin; }
        .pmb pre { font-family:'DM Sans',sans-serif; font-size:12.5px; color:rgba(255,255,255,0.5); line-height:1.75; white-space:pre-wrap; }
        .pmf { padding:12px 18px; border-top:1px solid rgba(255,255,255,0.07); display:flex; justify-content:flex-end; }
        .pmf button { padding:7px 20px; border-radius:8px; background:#7c6af7; border:none;
          color:#fff; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600; cursor:pointer; transition:background 0.18s; }
        .pmf button:hover { background:#6b5ee0; }
      </style>

      <div id="overlay">
        <div id="card">
          <div class="card-header">
            <div class="logo">AI<em>Lens</em></div>
            <button id="hide-btn">Hide ↓</button>
          </div>
          <p>Enter your one-time licence key to activate AILens. You only need to do this once on this browser.</p>
          <div class="field">
            <div class="field-label">Licence Key</div>
            <div class="key-wrap">
              <input id="key-input" type="password" placeholder="Enter your 10-character key" spellcheck="false" autocomplete="off" maxlength="10" />
              <button id="toggle-vis" title="Show/hide key">👁</button>
            </div>
          </div>
          <div class="eula-row">
            <input type="checkbox" id="eula-check" />
            <label for="eula-check">
              I have read and agree to the
              <button class="eula-link" id="eula-btn">User Policy Agreement</button>
            </label>
          </div>
          <div id="err"></div>
          <button id="activate-btn" disabled>Activate</button>
          <div class="hint">Need a key? Click the <strong>⊞ grid button</strong> at the bottom-left to open the Dashboard.<br>
          First time? Make sure cloud storage is configured — click ⚙ Cloud Setup below.</div>
          <button id="cloud-setup-btn" style="background:none;border:none;color:rgba(124,106,247,0.55);font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;text-decoration:underline;padding:0;">⚙ Cloud Setup (JSONBin)</button>
        </div>
      </div>

      <div id="show-tab">🔑 AILens — Enter Key</div>

      <div id="pm-wrap">
        <div id="pm-box">
          <div class="pmh"><h3>📋 User Policy Agreement</h3><button id="pm-close">✕</button></div>
          <div class="pmb"><pre>${EULA_TEXT}</pre></div>
          <div class="pmf"><button id="pm-ok">Got it</button></div>
        </div>
      </div>

      <div id="cs-wrap">
        <div id="cs-box">
          <div class="pmh"><h3>☁️ Cloud Setup (JSONBin)</h3><button id="cs-close">✕</button></div>
          <div class="pmb" style="display:flex;flex-direction:column;gap:12px;padding:18px;">
            <p style="font-size:12.5px;color:rgba(255,255,255,0.45);line-height:1.7;">
              To activate with a key from another computer, both computers must point to the same JSONBin bin.<br><br>
              Get your Bin ID and API Key from <a href="https://jsonbin.io" target="_blank" style="color:#9d8fff">jsonbin.io</a> — it's free.
            </p>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.5px;">Bin ID</div>
              <input id="cs-bin-id" type="text" placeholder="6507a123456789abcde…" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 11px;font-family:'DM Mono',monospace;font-size:12px;color:#fff;outline:none;width:100%;" />
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.5px;">API Key (Master)</div>
              <input id="cs-bin-key" type="password" placeholder="$2a$10$…" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 11px;font-family:'DM Mono',monospace;font-size:12px;color:#fff;outline:none;width:100%;" />
            </div>
            <div id="cs-err" style="font-size:11.5px;color:#f87171;min-height:15px;font-weight:500;"></div>
          </div>
          <div class="pmf" style="gap:8px;">
            <button id="cs-save" style="padding:7px 20px;border-radius:8px;background:#7c6af7;border:none;color:#fff;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;">Save</button>
          </div>
        </div>
      </div>
    `;

    const input   = sh.getElementById('key-input');
    const btn     = sh.getElementById('activate-btn');
    const errEl   = sh.getElementById('err');
    const eulaChk = sh.getElementById('eula-check');
    const overlay = sh.getElementById('overlay');
    const showTab = sh.getElementById('show-tab');

    sh.getElementById('hide-btn').addEventListener('click', () => {
      overlay.classList.add('hidden');
      showTab.classList.add('visible');
    });
    showTab.addEventListener('click', () => {
      overlay.classList.remove('hidden');
      showTab.classList.remove('visible');
      input.focus();
    });

    sh.getElementById('toggle-vis').addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    eulaChk.addEventListener('change', () => { btn.disabled = !eulaChk.checked; });
    sh.getElementById('eula-btn').addEventListener('click', () => sh.getElementById('pm-wrap').classList.add('open'));
    sh.getElementById('pm-close').addEventListener('click', () => sh.getElementById('pm-wrap').classList.remove('open'));
    sh.getElementById('pm-ok').addEventListener('click',    () => sh.getElementById('pm-wrap').classList.remove('open'));
    sh.getElementById('pm-wrap').addEventListener('click', e => {
      if (e.target === sh.getElementById('pm-wrap')) sh.getElementById('pm-wrap').classList.remove('open');
    });

    sh.getElementById('cloud-setup-btn').addEventListener('click', () => sh.getElementById('cs-wrap').classList.add('open'));
    sh.getElementById('cs-close').addEventListener('click', () => sh.getElementById('cs-wrap').classList.remove('open'));
    sh.getElementById('cs-wrap').addEventListener('click', e => { if (e.target === sh.getElementById('cs-wrap')) sh.getElementById('cs-wrap').classList.remove('open'); });
    sh.getElementById('cs-save').addEventListener('click', () => {
      const csErr = sh.getElementById('cs-err');
      const bid  = sh.getElementById('cs-bin-id').value.trim();
      const bkey = sh.getElementById('cs-bin-key').value.trim();
      if (!bid)  { csErr.textContent = 'Please enter your Bin ID.'; return; }
      if (!bkey) { csErr.textContent = 'Please enter your API Key.'; return; }
      GM_setValue('ailens_bin_id',  bid);
      GM_setValue('ailens_bin_key', bkey);
      sh.getElementById('cs-wrap').classList.remove('open');
      errEl.style.color = '#4ade80';
      errEl.textContent = '✅ Cloud storage saved — you can now activate.';
      setTimeout(() => { errEl.style.color = ''; errEl.textContent = ''; }, 3000);
    });

    const existingBinId  = GM_getValue('ailens_bin_id',  '');
    const existingBinKey = GM_getValue('ailens_bin_key', '');
    if (existingBinId)  sh.getElementById('cs-bin-id').value  = existingBinId;
    if (existingBinKey) sh.getElementById('cs-bin-key').value = existingBinKey;
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });

    btn.addEventListener('click', async () => {
      if (!eulaChk.checked) { errEl.textContent = 'Please agree to the User Policy Agreement first.'; return; }
      const val = input.value.trim();
      if (!val) { errEl.textContent = 'Please enter a key.'; return; }
      btn.disabled = true;
      btn.textContent = '☁ Checking cloud…';

      try {
        const ok = await validateAndConsume(val);
        if (ok) {
          btn.textContent = '✅ Activated!';
          btn.style.background = '#16a34a';
          setTimeout(() => { host.remove(); showTab.remove(); init(); }, 900);
        } else {
          errEl.textContent = 'Invalid or already-used key. Please check and try again.';
          btn.textContent = 'Activate';
          btn.disabled = !eulaChk.checked;
          input.style.borderColor = 'rgba(239,68,68,0.6)';
          setTimeout(() => { input.style.borderColor = ''; }, 1500);
        }
      } catch (err) {
        errEl.textContent = `Cloud error: ${err.message}. Check your internet connection.`;
        btn.textContent = 'Activate';
        btn.disabled = !eulaChk.checked;
      }
    });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildUI);
    } else {
      buildUI();
    }
  }

  (function () {
    const run = () => {
      if (!checkIntegrity()) { showPiracyNotice(); return; }
      if (checkActivation()) { init(); } else { showKeyGate(); }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  })();

})();

// ════════════════════════════════════════════════════════════════
//  DASHBOARD PRO — FULLY INTEGRATED (second IIFE)
// ════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const BIN_ID_KEY = 'ailens_bin_id';
  const API_KEY_KEY = 'ailens_bin_key';

  function getBin() { return GM_getValue(BIN_ID_KEY, ''); }
  function getKey() { return GM_getValue(API_KEY_KEY, ''); }

  function genKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function loadPool() {
    return new Promise(res => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.jsonbin.io/v3/b/${getBin()}/latest`,
        headers: { 'X-Master-Key': getKey(), 'X-Bin-Meta': 'false' },
        onload(r) {
          try {
            const d = JSON.parse(r.responseText);
            res(Array.isArray(d) ? d : (d.record || []));
          } catch { res([]); }
        },
        onerror: () => res([])
      });
    });
  }

  function savePool(pool) {
    return new Promise(res => {
      GM_xmlhttpRequest({
        method: 'PUT',
        url: `https://api.jsonbin.io/v3/b/${getBin()}`,
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': getKey(),
          'X-Bin-Versioning': 'false'
        },
        data: JSON.stringify(pool),
        onload: () => res(),
        onerror: () => res()
      });
    });
  }

  const root = document.createElement('div');
  root.id = 'ailens-dashboard-root';
  document.body.appendChild(root);
  const sh = root.attachShadow({ mode: 'open' });

  sh.innerHTML = `
  <style>
    #fab {position:fixed;bottom:16px;left:16px;z-index:2147483647;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#7c6af7,#9d8fff);display:flex;align-items:center;justify-content:center;color:white;font-size:22px;font-weight:700;cursor:pointer;box-shadow:0 8px 28px rgba(124,106,247,0.6);transition:0.25s cubic-bezier(0.4,0,0.2,1);}
    #fab:hover {transform:scale(1.12);}
    #overlay {position:fixed;inset:0;background:rgba(0,0,0,0.88);backdrop-filter:blur(14px);display:none;align-items:center;justify-content:center;z-index:2147483646;font-family:system-ui,-apple-system,sans-serif;}
    #modal {width:620px;max-width:95vw;background:#0f0f17;border-radius:18px;padding:24px;color:#fff;box-shadow:0 30px 90px rgba(0,0,0,0.85);}
    .header {display:flex;align-items:center;margin-bottom:18px;}
    .title {font-size:19px;font-weight:700;letter-spacing:-0.4px;}
    .spacer {flex:1;}
    .btn {background:#1f1f2b;border:1px solid rgba(255,255,255,0.1);padding:7px 14px;border-radius:9px;color:#fff;cursor:pointer;font-size:13px;font-weight:500;}
    .btn:hover {background:#2c2c3a;}
    .btn.primary {background:#7c6af7;border:none;}
    .keys {margin-top:12px;max-height:380px;overflow:auto;font-family:ui-monospace,monospace;font-size:13px;background:rgba(255,255,255,0.03);border-radius:10px;padding:6px;}
    .key {padding:9px 12px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;}
    .status {font-size:12px;color:#aaa;margin-top:10px;}
  </style>
  <div id="fab">🔑</div>
  <div id="overlay">
    <div id="modal">
      <div class="header"><div class="title">AILens Dashboard Pro</div><div class="spacer"></div><button class="btn" id="close">✕</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="cloud">⚙️ Cloud Setup</button>
        <button class="btn primary" id="gen">+ Generate New Key</button>
        <button class="btn" id="sync">↻ Sync Keys</button>
      </div>
      <div class="status" id="status">Ready</div>
      <div class="keys" id="keys"></div>
    </div>
  </div>`;

  const fab = sh.getElementById('fab');
  const overlay = sh.getElementById('overlay');
  const statusEl = sh.getElementById('status');
  const keysDiv = sh.getElementById('keys');

  fab.onclick = () => { overlay.style.display = 'flex'; refresh(); };
  sh.getElementById('close').onclick = () => overlay.style.display = 'none';

  sh.getElementById('cloud').onclick = () => {
    const bin = prompt("JSONBin Bin ID:");
    const key = prompt("JSONBin Master API Key:");
    if (bin && key) {
      GM_setValue(BIN_ID_KEY, bin);
      GM_setValue(API_KEY_KEY, key);
      alert("✅ Cloud connected! You can now generate keys.");
    }
  };

  sh.getElementById('gen').onclick = async () => {
    if (!getBin() || !getKey()) { alert("Please set up Cloud first (⚙️ button)"); return; }
    const pool = await loadPool();
    pool.push({ key: genKey(), used: false, revoked: false });
    await savePool(pool);
    refresh();
  };

  sh.getElementById('sync').onclick = refresh;

  async function refresh() {
    if (!getBin() || !getKey()) {
      statusEl.textContent = "⚠️ Cloud not configured";
      keysDiv.innerHTML = `<div style="padding:20px;text-align:center;color:#888;">Set up Cloud first</div>`;
      return;
    }
    statusEl.textContent = "☁ Syncing...";
    const pool = await loadPool();
    statusEl.textContent = `☁ ${pool.length} keys in pool`;
    keysDiv.innerHTML = pool.map(k => `
      <div class="key">
        <span>${k.key}</span>
        <span style="color:${k.used?'#f59e0b':k.revoked?'#ef4444':'#22c55e'}">
          ${k.used ? 'USED' : k.revoked ? 'REVOKED' : 'AVAILABLE'}
        </span>
      </div>`).join('');
  }

  console.log('%c[AILens] ✅ Dashboard Pro fully integrated', 'color:#7c6af7;font-weight:bold');
})();
