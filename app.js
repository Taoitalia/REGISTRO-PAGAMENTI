/* Registro pagamenti — app per cellulare e PC.
   I dati vivono sul dispositivo (funziona anche offline) e si sincronizzano con il Foglio Google
   attraverso l'app web Apps Script. Ogni modifica va in una coda e parte appena c'è connessione. */
(function () {
  'use strict';

  const VERSIONE_APP = '772177f1';
  const KEY = 'registro-pagamenti:v1';
  const TABELLE = ['corsi', 'soci', 'iscrizioni', 'pagamenti'];
  // «allenatore»: contanti incassati dall'allenatore e non ancora consegnati in cassa (in rosso finché non arrivano)
  const MEZZI = { contanti: 'Contanti', allenatore: 'All’allenatore', sumup: 'SumUp', banca: 'Bonifico', paypal: 'PayPal', satispay: 'Satispay' };
  const nomeMezzo = (m) => (m === 'allenatore' ? 'Contanti all’allenatore, da consegnare' : MEZZI[m] || m || '');
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const MESI3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const INIZIALI = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];

  // ------------------------------------------------------------------ utilità
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const oggi = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  const adesso = () => new Date().toISOString();
  const meseCorrente = () => oggi().slice(0, 7);
  const fmtData = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  const ggmm = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
  const eur = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const numIn = (v) => { const t = String(v == null ? '' : v).trim(); if (!t) return null; const n = Number(t.replace(',', '.')); return isFinite(n) ? n : null; };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`´]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const addMonths = (ym, k) => { let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad2(m + 1); };
  const meseNome = (ym) => MESI[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  const mese3 = (ym) => MESI3[Number(ym.slice(5, 7)) - 1];
  const esDi = (iso) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); return m >= 9 ? y + '-' + (y + 1) : (y - 1) + '-' + y; };
  const mesiEs = (es) => { const y = Number(es.slice(0, 4)); const out = []; let ym = y + '-09'; for (let i = 0; i < 12; i++) { out.push(ym); ym = addMonths(ym, 1); } return out; };
  const esCorrente = () => esDi(oggi());
  // elenco mesi «ott, nov» o «ott–dic»
  function elencoMesi(lst) {
    const s = lst.slice().sort();
    const out = []; let a = null, b = null;
    s.forEach((y) => { if (b && addMonths(b, 1) === y) b = y; else { if (a) out.push([a, b]); a = b = y; } });
    if (a) out.push([a, b]);
    return out.map(([x, y]) => (x === y ? mese3(x) : mese3(x) + '–' + mese3(y))).join(', ');
  }

  // ------------------------------------------------------------------ archivio locale
  function vuoto() { return { corsi: {}, soci: {}, iscrizioni: {}, pagamenti: {} }; }
  const S = {
    view: 'incassa',
    es: esCorrente(),
    conf: { url: '', chiave: '', dispositivo: '', quotaIscrizione: 25 },
    dati: vuoto(),
    coda: [],
    sync: { stato: 'idle', ultima: null, errore: null },
    F: null,
    corso: null,
    qSoci: '',
    qUltimi: '',
    dialog: null,
    imp: null,
    cr: null, // copia del cruscotto inviata dal Bilancio (dal Foglio Google)
    versioneFoglio: null
  };
  function carica() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (x) {
        S.conf = { ...S.conf, ...(x.conf || {}) };
        S.dati = { ...vuoto(), ...(x.dati || {}) };
        S.coda = Array.isArray(x.coda) ? x.coda : [];
        S.sync.ultima = x.ultima || null;
        if (x.es) S.es = x.es;
        if (x.corso) S.corso = x.corso;
        if (x.cr) S.cr = x.cr;
        if (x.versioneFoglio) S.versioneFoglio = x.versioneFoglio;
      }
    } catch (e) { console.warn(e); }
    // destinatari scritti con la versione che li salvava nel foglio: tornano nelle impostazioni del dispositivo
    if (S.dati.invii) {
      const vecchi = Object.values(S.dati.invii).filter((x) => x && x.id && !x.eliminato);
      if (vecchi.length && !Array.isArray(S.conf.invii)) S.conf.invii = vecchi.map((x) => ({ id: x.id, nome: x.nome || 'Destinatario', tel: x.telefono || '', corsi: String(x.corsi || '').split('|').filter(Boolean), ultimo: x.ultimo || null }));
      delete S.dati.invii;
      S.coda = S.coda.filter((x) => x.t !== 'invii');
    }
    if (!S.conf.dispositivo) {
      const ua = navigator.userAgent || '';
      S.conf.dispositivo = (/Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'PC' : 'Dispositivo') + ' ' + Math.random().toString(36).slice(2, 5).toUpperCase();
    }
  }
  function salva() {
    try { localStorage.setItem(KEY, JSON.stringify({ conf: S.conf, dati: S.dati, coda: S.coda, ultima: S.sync.ultima, es: S.es, corso: S.corso, cr: S.cr, versioneFoglio: S.versioneFoglio })); }
    catch (e) { console.warn(e); toast('Lo spazio del dispositivo è pieno: i dati non sono stati salvati.', 'err'); }
  }

  // ogni modifica: aggiorna il dato locale e la mette in coda per il foglio
  function scrivi(t, r) {
    const rec = { ...r, modificato: adesso() };
    S.dati[t][rec.id] = rec;
    S.coda = S.coda.filter((x) => !(x.t === t && x.r.id === rec.id));
    S.coda.push({ t, r: rec });
    return rec;
  }
  function fatto() { salva(); render(); pianificaSync(800); }

  const vivi = (t) => Object.values(S.dati[t]).filter((r) => r && !r.eliminato);
  const corsi = () => vivi('corsi').sort((a, b) => (Number(a.ordine) || 0) - (Number(b.ordine) || 0) || String(a.nome).localeCompare(String(b.nome), 'it'));
  const corsiAttivi = () => corsi().filter((c) => c.attivo !== false);
  const corso = (id) => S.dati.corsi[id] || null;
  const socio = (id) => S.dati.soci[id] || null;
  const titoloCorso = (c) => (c ? c.titolo || c.nome : '?');
  const nomeCorso = (c) => (c ? c.nome : '?');
  function mesiCorso(c, es) {
    const all = mesiEs(es || S.es);
    const n = c && c.mesi ? String(c.mesi).length : 11;
    return all.slice(0, Math.max(1, Math.min(12, n)));
  }
  const iscrizioniSocio = (sid, es) => vivi('iscrizioni').filter((i) => i.socio === sid && i.esercizio === (es || S.es) && corso(i.corso));
  const iscrizioniCorso = (cid, es) => vivi('iscrizioni').filter((i) => i.corso === cid && i.esercizio === (es || S.es) && socio(i.socio));
  const pagamentiSocio = (sid, es) => vivi('pagamenti').filter((p) => p.socio === sid && p.esercizio === (es || S.es));
  // mesi (e iscrizione) da non incassare: «2026-10», oppure «2026-10=20» con un importo che resta solo nell'app
  // (compare nella casella al posto della data; il Bilancio riceve il mese da non incassare, senza importo)
  const vociNonDovute = (isc) => String((isc && isc.nonDovuti) || '').split(',').map((x) => x.trim()).filter(Boolean);
  const nonDovuti = (isc) => new Set(vociNonDovute(isc).map((x) => x.split('=')[0]));
  function importiNonDovuti(isc) {
    const m = new Map();
    vociNonDovute(isc).forEach((x) => { const i = x.indexOf('='); if (i < 0) return; const v = Number(x.slice(i + 1)); if (x.slice(i + 1) !== '' && isFinite(v)) m.set(x.slice(0, i), v); });
    return m;
  }
  function testoNonDovuti(set, importi) {
    const arr = Array.from(set).sort((a, b) => (a === 'I' ? -1 : b === 'I' ? 1 : a.localeCompare(b)));
    return arr.length ? arr.map((k) => (importi && importi.has(k) ? k + '=' + importi.get(k) : k)).join(',') : null;
  }
  const impBreve = (v) => (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : eur(v));
  const quotaIsc = (isc) => { const c = corso(isc.corso); return isc.quota != null && isc.quota !== '' ? Number(isc.quota) : Number(c && c.quota) || 0; };
  const inCoda = (t, id) => S.coda.some((x) => x.t === t && x.r.id === id);
  // telefono del socio: numero con il prefisso (italiano se manca) per scrivere su WhatsApp
  function numeroTel(t) {
    const C = window.Core;
    const n = C && C.normalizzaTelefono ? C.normalizzaTelefono(t, '39') : String(t || '').replace(/\D/g, '');
    return n && n.length >= 9 ? n : '';
  }
  const ICONA_MSG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>';
  // pulsante per scrivere su WhatsApp: a icona (elenco soci, incasso) o con la scritta (scheda del socio)
  function contattiHtml(tel, conTesto) {
    const n = numeroTel(tel);
    if (!n) return '';
    return '<span class="contatti"><a class="' + (conTesto ? 'btn sm' : 'ic-btn') + '" href="https://wa.me/' + n + '" target="_blank" rel="noopener" aria-label="Scrivi su WhatsApp a ' + esc(tel) + '" title="WhatsApp ' + esc(tel) + '">' + ICONA_MSG + (conTesto ? 'WhatsApp' : '') + '</a></span>';
  }
  // importo di un pagamento: quello scritto, oppure (pagamenti importati dall'Excel senza importo) la quota
  function importoPag(p) {
    if (p.importo != null && p.importo !== '') return Number(p.importo);
    if (p.voce === 'iscrizione') return Number(S.conf.quotaIscrizione) || 0;
    const isc = vivi('iscrizioni').find((i) => i.socio === p.socio && i.corso === p.corso && i.esercizio === p.esercizio);
    return isc ? quotaIsc(isc) : Number((corso(p.corso) || {}).quota) || 0;
  }
  // situazione di un socio: celle pagate per corso e mese, iscrizione, mesi grigi
  function situazione(sid, es) {
    const pag = pagamentiSocio(sid, es);
    const cell = new Map();
    pag.forEach((p) => { const k = p.voce === 'iscrizione' ? 'I' : p.corso + '|' + p.mese; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(p); });
    const isc = iscrizioniSocio(sid, es);
    const iscrNonDovuta = isc.some((i) => nonDovuti(i).has('I'));
    return { pag, cell, isc, iscrPagata: cell.has('I'), iscrNonDovuta };
  }

  // ------------------------------------------------------------------ sincronizzazione con il Foglio Google
  let timerSync = null;
  function pianificaSync(ms) { clearTimeout(timerSync); timerSync = setTimeout(sincronizza, ms); }
  function collegato() { return !!(S.conf.url && S.conf.chiave); }
  async function chiama(metodo, corpo) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    try {
      let res;
      if (metodo === 'GET') res = await fetch(S.conf.url + (S.conf.url.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(S.conf.chiave) + '&a=' + (corpo || 'dati'), { cache: 'no-store', signal: ctrl.signal, redirect: 'follow' });
      else res = await fetch(S.conf.url, { method: 'POST', body: JSON.stringify({ k: S.conf.chiave, ...corpo }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal, redirect: 'follow' });
      const txt = await res.text();
      let j;
      try { j = JSON.parse(txt); } catch (e) { throw new Error(/<html/i.test(txt) ? 'L’indirizzo non risponde come l’app web del foglio: controlla l’URL (deve finire con /exec) e che il deployment sia per «Chiunque».' : 'Risposta non valida dal foglio.'); }
      if (!j.ok) throw new Error(j.errore === 'chiave' ? 'Chiave di accesso sbagliata.' : 'Il foglio ha risposto: ' + (j.errore || 'errore'));
      return j;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Il foglio non ha risposto in tempo.');
      if (e instanceof TypeError) throw new Error(navigator.onLine === false ? 'Sei offline.' : 'Il foglio non è raggiungibile: controlla la connessione e l’URL.');
      throw e;
    } finally { clearTimeout(t); }
  }
  function applicaServer(tabelle) {
    const d = vuoto();
    TABELLE.forEach((t) => (tabelle[t] || []).forEach((r) => { if (r && r.id) d[t][r.id] = r; }));
    // quello che non è ancora arrivato al foglio resta com'è sul dispositivo
    S.coda.forEach((x) => { const v = d[x.t][x.r.id]; if (!v || String(x.r.modificato) >= String(v.modificato || '')) d[x.t][x.r.id] = x.r; });
    S.dati = d;
  }
  let syncInCorso = null;
  async function sincronizza() {
    clearTimeout(timerSync);
    if (!collegato()) { S.sync.stato = 'idle'; renderSync(); return; }
    if (navigator.onLine === false) { S.sync.stato = 'offline'; renderSync(); return; }
    if (syncInCorso) return syncInCorso;
    syncInCorso = (async () => {
      S.sync.stato = 'corso'; renderSync();
      try {
        let j;
        if (S.coda.length) {
          const invio = S.coda.slice(0, 300);
          j = await chiama('POST', { a: 'salva', modifiche: invio, rileggi: true, dispositivo: S.conf.dispositivo });
          S.coda = S.coda.filter((x) => !invio.some((y) => y.t === x.t && y.r.id === x.r.id && y.r.modificato === x.r.modificato));
        } else {
          j = await chiama('GET', 'dati');
        }
        if (j.tabelle) applicaServer(j.tabelle);
        // il cruscotto del Bilancio (script del foglio dalla versione 2)
        if ('cruscotto' in j) S.cr = j.cruscotto || null;
        if (j.versione) S.versioneFoglio = j.versione;
        S.sync.ultima = adesso();
        S.sync.errore = null;
        S.sync.stato = 'ok';
        salva();
        if (S.coda.length) pianificaSync(300);
      } catch (e) {
        S.sync.errore = e.message || String(e);
        S.sync.stato = navigator.onLine === false ? 'offline' : 'errore';
        pianificaSync(60000);
      } finally {
        syncInCorso = null;
        if (!S.dialog) render(); else renderSync();
      }
    })();
    return syncInCorso;
  }

  // ------------------------------------------------------------------ messaggi
  function toast(msg, kind, azione, ms) {
    const box = $('#toast');
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (azione ? '<button type="button">' + esc(azione.label) + '</button>' : '');
    if (azione) el.querySelector('button').addEventListener('click', () => { azione.fn(); el.remove(); });
    box.appendChild(el);
    setTimeout(() => el.remove(), ms || (azione ? 8000 : 4000));
  }

  // ------------------------------------------------------------------ rendering
  const ICONE = {
    incassa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    corsi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 4v16"/></svg>',
    soci: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.3 3.5 5.2"/></svg>',
    ultimi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    cruscotto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 17a9 9 0 1 1 17 0"/><path d="M12 13l4-5"/><circle cx="12" cy="13.5" r="1.4"/><path d="M3 20h18"/></svg>',
    altro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };
  const VISTE = [['incassa', 'Incassa'], ['corsi', 'Corsi'], ['soci', 'Soci'], ['ultimi', 'Ultimi'], ['cruscotto', 'Cruscotto'], ['altro', 'Altro']];
  // la sezione Cruscotto compare quando il Bilancio ha inviato i suoi dati
  const visteAttive = () => VISTE.filter(([id]) => id !== 'cruscotto' || S.cr || S.view === 'cruscotto');

  function esercizi() {
    const set = new Set([esCorrente(), S.es]);
    vivi('iscrizioni').forEach((i) => i.esercizio && set.add(i.esercizio));
    vivi('pagamenti').forEach((p) => p.esercizio && set.add(p.esercizio));
    return Array.from(set).sort().reverse();
  }
  function htmlSync() {
    let cls = 'ok', txt = 'Sincronizzato';
    if (!collegato()) { cls = 'offline'; txt = 'Solo su questo dispositivo'; }
    else if (S.sync.stato === 'corso') { cls = 'corso'; txt = 'Sincronizzo…'; }
    else if (S.sync.stato === 'offline' || navigator.onLine === false) { cls = 'attesa'; txt = 'Offline' + (S.coda.length ? ' · ' + S.coda.length + ' da inviare' : ''); }
    else if (S.sync.stato === 'errore') { cls = 'errore'; txt = 'Non sincronizzato'; }
    else if (S.coda.length) { cls = 'attesa'; txt = S.coda.length + ' da inviare'; }
    return '<button class="sync ' + cls + '" data-act="sync" title="' + esc(S.sync.errore || (S.sync.ultima ? 'Ultima sincronizzazione ' + new Date(S.sync.ultima).toLocaleString('it-IT') : '')) + '"><i></i>' + esc(txt) + '</button>';
  }
  function renderSync() { const el = $('#sync'); if (el) el.innerHTML = htmlSync(); }

  function render() {
    const app = $('#app');
    const y = window.scrollY;
    const att = document.activeElement && document.activeElement.id;
    app.innerHTML =
      '<header class="top"><h1><span class="t-lungo">Registro pagamenti</span><span class="t-corto">Pagamenti</span></h1>' +
      '<select id="es" aria-label="Anno sportivo">' + esercizi().map((e) => '<option' + (e === S.es ? ' selected' : '') + '>' + e + '</option>').join('') + '</select>' +
      '<span id="sync">' + htmlSync() + '</span></header>' +
      '<nav class="tabs">' + visteAttive().map(([id, l]) => '<a href="#' + id + '" class="' + (S.view === id ? 'on' : '') + '"' + (S.view === id ? ' aria-current="page"' : '') + '>' + ICONE[id] + '<span>' + l + '</span></a>').join('') + '</nav>' +
      '<main>' + (S.view === 'incassa' || S.view === 'corsi' ? bannerInvii() : '') + ({ incassa: viewIncassa, corsi: viewCorsi, soci: viewSoci, ultimi: viewUltimi, cruscotto: viewCruscotto, altro: viewAltro }[S.view] || viewIncassa)() + '</main>';
    renderDialog();
    if (att) { const n = document.getElementById(att); if (n && n.tagName === 'INPUT') { const v = n.value; n.focus(); try { n.setSelectionRange(v.length, v.length); } catch (e) { /* */ } } }
    window.scrollTo(0, y);
  }

  // ------------------------------------------------------------------ vista: incassa
  function nuovoForm() {
    return { socio: null, q: '', sel: {}, iscr: false, quote: {}, impIscr: Number(S.conf.quotaIscrizione) || 25, mezzo: 'contanti', data: oggi(), nota: '', ricorda: {} };
  }
  function scegliSocio(sid, preset, tieniUnisci) {
    const u = tieniUnisci && S.F ? S.F.unisci : null;
    const F = S.F = nuovoForm();
    if (u) F.unisci = u;
    F.socio = sid;
    const st = situazione(sid);
    st.isc.forEach((i) => { F.quote[i.corso] = quotaIsc(i); });
    F.iscr = !st.iscrPagata && !st.iscrNonDovuta;
    if (preset) { F.sel = { ...preset }; return; }
    // propone il primo mese da pagare di ogni corso; chi non ha ancora pagato niente per quel corso parte dal mese corrente
    const ora = meseCorrente();
    st.isc.forEach((i) => {
      const c = corso(i.corso);
      const nd = nonDovuti(i);
      const mc = mesiCorso(c);
      const giaPagato = mc.some((ym) => st.cell.has(i.corso + '|' + ym));
      const libero = (ym) => !st.cell.has(i.corso + '|' + ym) && !nd.has(ym);
      const m = giaPagato ? mc.find(libero) : (mc.find((ym) => ym >= ora && libero(ym)) || mc.find(libero));
      if (m) F.sel[i.corso + '|' + m] = true;
    });
  }
  function righeImporto(F) {
    const st = situazione(F.socio);
    const righe = [];
    st.isc.forEach((i) => {
      const mesi = Object.keys(F.sel).filter((k) => F.sel[k] && k.startsWith(i.corso + '|')).map((k) => k.split('|')[1]).sort();
      if (!mesi.length) return;
      const q = F.quote[i.corso] != null ? F.quote[i.corso] : quotaIsc(i);
      righe.push({ corso: i.corso, isc: i, mesi, quota: q, totale: r2(q * mesi.length) });
    });
    return righe;
  }
  function viewIncassa() {
    if (!S.F) S.F = nuovoForm();
    const F = S.F;
    if (!corsi().length) {
      return '<div class="panel pad stack"><h2>Benvenuto</h2><p class="muted">Per cominciare servono i corsi e i soci. Puoi importarli dal registro Excel (dal PC) oppure collegare l’app al Foglio Google, se su un altro dispositivo li hai già caricati.</p><div class="row"><a class="btn primary" href="#altro">Vai alle impostazioni</a></div></div>';
    }
    let h = '<div class="stack">' + bannerUnisci(F);
    if (!F.socio) {
      const q = norm(F.q);
      const toks = q.split(' ').filter(Boolean);
      const lst = toks.length ? vivi('soci').filter((s) => { const n = norm(s.nominativo); return toks.every((t) => n.includes(t)); }).sort((a, b) => a.nominativo.localeCompare(b.nominativo, 'it')).slice(0, 12) : [];
      h += '<div class="panel pad stack"><h2 class="sez">' + (F.unisci ? 'Chi altro paga con questo pagamento' : 'Chi paga') + '</h2>' +
        '<div class="cerca"><label class="field"><span>Cerca il socio</span><input class="in" id="cerca-socio" type="search" autocomplete="off" placeholder="Nome o cognome" value="' + esc(F.q) + '"></label>' +
        (lst.length ? '<div class="sugg" role="listbox">' + lst.map((s) => { const isc = iscrizioniSocio(s.id); return '<button type="button" data-socio="' + esc(s.id) + '"><span>' + esc(s.nominativo) + '</span><small>' + esc(isc.map((i) => nomeCorso(corso(i.corso))).join(', ') || 'nessun corso ' + S.es) + '</small></button>'; }).join('') + '</div>' : (toks.length ? '<div class="sugg"><div class="empty small">Nessun socio con questo nome.</div></div>' : '')) +
        '</div><div><button class="btn" data-act="nuovo-socio">+ Nuovo socio</button></div></div>';
      if (!F.unisci) h += ultimiBreve();
      return h + '</div>';
    }
    const so = socio(F.socio);
    const st = situazione(F.socio);
    h += '<div class="socio-sel"><div><b>' + esc(so.nominativo) + '</b><div class="small muted">' + esc(st.isc.map((i) => titoloCorso(corso(i.corso))).join(' · ') || 'Nessun corso nel ' + S.es) + '</div></div>' + contattiHtml(so.telefono) + '<button class="btn sm" data-act="cambia-socio">Cambia</button></div>';
    if (!st.isc.length) {
      h += '<div class="panel pad stack"><div class="msg warn">' + esc(so.nominativo) + ' non è iscritto a nessun corso nel ' + esc(S.es) + '.</div><div><button class="btn primary" data-act="iscrivi" data-socio="' + esc(so.id) + '">Iscrivi a un corso</button></div></div>';
      return h + '</div>';
    }
    // griglia dei mesi: una riga per corso
    const mesi = mesiEs(S.es);
    const ora = meseCorrente();
    h += '<div class="panel pad stack"><h2 class="sez">Cosa paga</h2><p class="small muted" style="margin:0">Tocca i mesi da incassare. Puoi sceglierne più di uno, anche su corsi diversi.</p><div class="mesi-grid"><table class="mg"><thead><tr><th></th><th>Iscr.</th>' + mesi.map((ym) => '<th>' + INIZIALI[Number(ym.slice(5, 7)) - 1] + '</th>').join('') + '</tr></thead><tbody>';
    st.isc.forEach((i, idx) => {
      const c = corso(i.corso);
      const mc = new Set(mesiCorso(c));
      const nd = nonDovuti(i);
      h += '<tr><th class="corso" title="' + esc(titoloCorso(c)) + '">' + esc(nomeCorso(c)) + '<small>€ ' + eur(quotaIsc(i)) + '/mese</small></th>';
      // iscrizione: una per socio, nella prima riga
      if (idx === 0) {
        const pag = st.cell.get('I');
        if (pag) h += '<td rowspan="' + st.isc.length + '"><div class="cell ass pag ' + esc(pag[0].mezzo) + '" title="Iscrizione pagata il ' + esc(fmtData(pag[0].data)) + '">I<small>' + esc(ggmm(pag[0].data)) + '</small></div></td>';
        else if (st.iscrNonDovuta && !F.iscr) h += '<td rowspan="' + st.isc.length + '"><button type="button" class="cell ass no" data-iscr title="Iscrizione da non incassare">I</button></td>';
        else h += '<td rowspan="' + st.isc.length + '"><button type="button" class="cell ass' + (F.iscr ? ' sel' : ' dovuto') + '" data-iscr aria-pressed="' + F.iscr + '" title="Iscrizione">I<small>€ ' + eur(F.impIscr) + '</small></button></td>';
      }
      mesi.forEach((ym) => {
        if (!mc.has(ym)) { h += '<td><div class="cell fuori"></div></td>'; return; }
        const k = i.corso + '|' + ym;
        const pag = st.cell.get(k);
        if (pag) { h += '<td><div class="cell pag ' + esc(pag[0].mezzo) + '" title="' + esc(meseNome(ym) + ': pagato il ' + fmtData(pag[0].data) + ' · ' + nomeMezzo(pag[0].mezzo)) + '">' + esc(ggmm(pag[0].data)) + '</div></td>'; return; }
        if (nd.has(ym)) {
          const ind = importiNonDovuti(i).get(ym);
          h += '<td><div class="cell no' + (ind != null ? ' imp' : '') + '" title="' + esc(meseNome(ym) + ': da non incassare' + (ind != null ? ' · € ' + eur(ind) + ' (solo nell’app)' : '')) + '">' + (ind != null ? '€ ' + esc(impBreve(ind)) : INIZIALI[Number(ym.slice(5, 7)) - 1]) + '</div></td>';
          return;
        }
        const sel = !!F.sel[k];
        h += '<td><button type="button" class="cell' + (sel ? ' sel' : ym <= ora ? ' dovuto' : '') + '" data-mese="' + esc(k) + '" aria-pressed="' + sel + '" title="' + esc(meseNome(ym)) + '">' + mese3(ym) + '</button></td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="legenda"><span><i style="background:var(--accent)"></i>da incassare ora</span><span><i style="background:var(--amber-soft);border-color:var(--amber)"></i>scaduto</span><span><i style="background:repeating-linear-gradient(135deg,var(--grigio) 0 3px,transparent 3px 6px)"></i>da non incassare</span><span><i style="background:var(--m-sumup)"></i>pagato</span></div>' +
      '<div><button class="btn sm ghost" data-act="iscrivi" data-socio="' + esc(so.id) + '">+ Iscrivi a un altro corso</button></div></div>';

    // importi
    const righe = righeImporto(F);
    const tot = r2(righe.reduce((x, r) => x + r.totale, 0) + (F.iscr ? num(F.impIscr) : 0));
    h += '<div class="panel pad stack"><h2 class="sez">Importo</h2><div class="righe-imp">' +
      (F.iscr ? '<div class="ri"><div><b>Iscrizione ' + esc(S.es) + '</b><small>quota associativa</small></div><input class="in num" inputmode="decimal" data-imp-iscr value="' + esc(String(F.impIscr).replace('.', ',')) + '" aria-label="Importo iscrizione"></div>' : '') +
      righe.map((r) => '<div class="ri"><div><b>' + esc(nomeCorso(corso(r.corso))) + ' · ' + esc(elencoMesi(r.mesi)) + '</b><small>' + r.mesi.length + ' × € ' + eur(r.quota) + ' = € ' + eur(r.totale) + '</small></div><input class="in num" inputmode="decimal" data-quota="' + esc(r.corso) + '" value="' + esc(String(r.quota).replace('.', ',')) + '" aria-label="Quota mensile ' + esc(nomeCorso(corso(r.corso))) + '"></div>' +
        (r.quota !== quotaIsc(r.isc) ? '<label class="small" style="display:flex;gap:8px;align-items:center;margin-top:-4px"><input type="checkbox" data-ricorda="' + esc(r.corso) + '"' + (F.ricorda[r.corso] ? ' checked' : '') + '> Usa € ' + eur(r.quota) + ' come quota mensile di ' + esc(so.nominativo) + ' per ' + esc(nomeCorso(corso(r.corso))) + '</label>' : '')).join('') +
      (!righe.length && !F.iscr ? '<div class="muted small">Scegli almeno un mese o l’iscrizione.</div>' : '') +
      '</div><div class="totale"><span>Totale</span><span>€ ' + eur(tot) + '</span></div></div>';

    // come e quando (nel pagamento unico restano quelli del primo socio)
    if (F.unisci) {
      h += '<div class="panel pad stack"><h2 class="sez">Come</h2><div class="small">' + esc(nomeMezzo(F.unisci.mezzo)) + ' · ' + esc(fmtData(F.unisci.data)) + '<span class="muted"> · come il resto del pagamento</span></div></div>';
    } else {
      h += '<div class="panel pad stack"><h2 class="sez">Come</h2><div class="seg" role="group" aria-label="Mezzo di pagamento">' +
        Object.keys(MEZZI).map((m) => '<button type="button" data-mezzo="' + m + '" class="' + (F.mezzo === m ? 'on' : '') + '" aria-pressed="' + (F.mezzo === m) + '">' + (m === 'contanti' ? '' : '<span class="sw" style="background:var(--m-' + m + ')"></span>') + MEZZI[m] + '</button>').join('') + '</div>' +
        '<div class="row"><label class="field"><span>Data del pagamento</span><input class="in" type="date" id="f-data" value="' + esc(F.data) + '" max="' + oggi() + '"></label>' +
        '<label class="field" style="flex:2 1 200px"><span>Nota (facoltativa)</span><input class="in" id="f-nota" value="' + esc(F.nota) + '" placeholder="per esempio: genitore di Mario e Luca"></label></div></div>';
    }
    h += '<div class="panel pad stack"><h2 class="sez">' + (F.unisci ? 'Altri soci nello stesso pagamento?' : 'Paga anche per altri soci?') + '</h2><p class="small muted" style="margin:0">Per esempio un genitore che paga per due figli con un solo bonifico o un’unica somma in contanti: registra questo socio e aggiungi gli altri. Nel Bilancio sarà una sola scrittura. Pagamenti fatti separatamente, anche di soci con lo stesso cognome, restano scritture separate.</p>' +
      '<div><button class="btn" data-act="registra-altro"' + (tot > 0 ? '' : ' disabled') + '>' + (F.unisci ? '+ Aggiungi e passa a un altro socio' : '+ Registra e aggiungi un altro socio') + '</button></div></div>';
    h += '<div class="savebar"><button class="btn primary big" data-act="registra"' + (tot > 0 ? '' : ' disabled') + '>' + (F.unisci ? 'Aggiungi € ' + eur(tot) + ' e chiudi il pagamento' : 'Registra € ' + eur(tot)) + '</button></div>';
    return h + '</div>';
  }
  function ultimiBreve() {
    const v = versamenti().slice(0, 5);
    if (!v.length) return '';
    return '<div class="panel"><div class="gruppo-data">Ultimi incassi</div><div class="lista">' + v.map(voceVersamento).join('') + '</div></div>';
  }
  // pagamento unico: più soci pagati con un solo movimento di denaro (stesso «versamento», stessa data e mezzo).
  // Nel Bilancio un versamento diventa una sola scrittura; incassi separati restano scritture separate.
  function bannerUnisci(F) {
    const U = F.unisci;
    if (!U) return '';
    const tot = r2(U.soci.reduce((x, s) => x + s.tot, 0));
    return '<div class="msg ok unisci"><div><b>Pagamento unico</b> · ' + esc(fmtData(U.data)) + ' · ' + esc(nomeMezzo(U.mezzo)) + '<br>' + U.soci.map((s) => esc(s.nome) + ' € ' + eur(s.tot)).join(' + ') + ' = € ' + eur(tot) +
      '<div class="small">Scegli il prossimo socio pagato con lo stesso movimento di denaro. Nel Bilancio diventa una sola scrittura.</div></div><button class="btn sm" data-act="unisci-fine">Fine</button></div>';
  }
  function registraPagamento(continua) {
    const F = S.F;
    const so = socio(F.socio);
    const righe = righeImporto(F);
    if (!righe.length && !F.iscr) return;
    const U = F.unisci;
    const data = U ? U.data : F.data, mezzo = U ? U.mezzo : F.mezzo, nota = U ? U.nota : (F.nota || null);
    if (!data) { toast('Indica la data del pagamento.', 'err'); return; }
    const st = situazione(F.socio);
    const ver = U ? U.ver : uid('v');
    const base = { versamento: ver, esercizio: S.es, data, socio: so.id, nominativo: so.nominativo, mezzo, nota: nota || null, dispositivo: S.conf.dispositivo, creato: adesso(), eliminato: false };
    const fatti = [];
    if (F.iscr) fatti.push(scrivi('pagamenti', { ...base, id: uid('p'), corso: st.isc[0].corso, voce: 'iscrizione', mese: null, importo: r2(num(F.impIscr)) }));
    righe.forEach((r) => {
      r.mesi.forEach((ym) => fatti.push(scrivi('pagamenti', { ...base, id: uid('p'), corso: r.corso, voce: 'mese', mese: ym, importo: r2(r.quota) })));
      if (F.ricorda[r.corso]) scrivi('iscrizioni', { ...r.isc, quota: r2(r.quota) });
    });
    const tot = r2(fatti.reduce((x, p) => x + num(p.importo), 0));
    const soci = (U ? U.soci : []).concat([{ nome: so.nominativo, tot }]);
    S.F = nuovoForm();
    if (continua) S.F.unisci = { ver, data, mezzo, nota, soci };
    fatto();
    const totU = r2(soci.reduce((x, s) => x + s.tot, 0));
    toast((soci.length > 1 ? 'Pagamento unico: ' + soci.map((s) => s.nome).join(' + ') + ', € ' + eur(totU) : 'Registrato: ' + so.nominativo + ', € ' + eur(tot)) + '.' + (continua ? ' Scegli il prossimo socio.' : ''), '', { label: 'Annulla', fn: () => { fatti.forEach((p) => scrivi('pagamenti', { ...S.dati.pagamenti[p.id], eliminato: true })); if (S.F && S.F.unisci && S.F.unisci.ver === ver) { S.F.unisci.soci = S.F.unisci.soci.slice(0, -1); if (!S.F.unisci.soci.length) S.F.unisci = null; } fatto(); toast('Annullato: ' + so.nominativo + ', € ' + eur(tot) + '.'); } });
    window.scrollTo(0, 0);
    if (continua) setTimeout(() => { const n = $('#cerca-socio'); if (n) n.focus(); }, 0);
  }

  // ------------------------------------------------------------------ vista: corsi (come il foglio Excel)
  function viewCorsi() {
    const cs = corsiAttivi();
    if (!cs.length) return '<div class="panel empty">Nessun corso. Aggiungili in «Altro» o importa il registro Excel.</div>';
    if (!S.corso || !corso(S.corso)) S.corso = cs[0].id;
    const c = corso(S.corso);
    const mesi = mesiCorso(c);
    const isc = iscrizioniCorso(c.id).sort((a, b) => socio(a.socio).nominativo.localeCompare(socio(b.socio).nominativo, 'it'));
    let h = '<div class="stack"><div class="corsi-sel" role="tablist">' + cs.map((x) => '<button role="tab" data-corso="' + esc(x.id) + '" class="' + (x.id === c.id ? 'on' : '') + '" aria-selected="' + (x.id === c.id) + '">' + esc(x.nome) + '</button>').join('') + '</div>' +
      '<div class="row" style="align-items:center"><div style="flex:3 1 220px"><h2 style="font-size:18px">' + esc(titoloCorso(c)) + '</h2><div class="small muted">' + isc.length + ' iscritti · € ' + eur(c.quota) + ' al mese</div></div><div style="flex:0 0 auto"><button class="btn sm" data-act="iscrivi-corso">+ Iscrivi un socio</button></div></div>';
    if (!isc.length) return h + '<div class="panel empty">Nessun iscritto a questo corso nel ' + esc(S.es) + '.</div></div>';
    h += '<div class="panel foglio"><table class="reg"><thead><tr><th class="nome">Nominativo</th><th>Cert.</th><th>I</th>' + mesi.map((ym) => '<th title="' + esc(meseNome(ym)) + '">' + INIZIALI[Number(ym.slice(5, 7)) - 1] + '</th>').join('') + '</tr></thead><tbody>';
    isc.forEach((i) => {
      const so = socio(i.socio);
      const st = situazione(so.id);
      const nd = nonDovuti(i);
      const scad = so.scadenzaCert;
      const cert = scad ? '<td class="cert' + (scad < oggi() ? ' scaduto' : '') + '" title="Certificato medico: scade il ' + esc(fmtData(scad)) + '">' + esc(ggmm(scad) + '/' + scad.slice(2, 4)) + '</td>' : '<td class="cert' + (so.certificato ? '' : ' scaduto') + '">' + (so.certificato ? '✓' : '—') + '</td>';
      h += '<tr><td class="nome"><button data-socio-ed="' + esc(so.id) + '">' + esc(so.nominativo) + '</button></td>' + cert;
      const cellaHtml = (k, label, isIscr) => {
        // l'iscrizione è una per socio: compare in tutti i suoi corsi
        const pag = isIscr ? st.cell.get('I') : st.cell.get(k);
        if (pag && pag.length) {
          const att = pag.some((p) => inCoda('pagamenti', p.id));
          return '<td class="c ' + esc(pag[0].mezzo) + (att ? ' attesa' : '') + '" data-cella="' + esc(so.id + '|' + c.id + '|' + (isIscr ? 'I' : k.split('|')[1])) + '" title="' + esc(label + ': ' + fmtData(pag[0].data) + ' · ' + nomeMezzo(pag[0].mezzo)) + '">' + esc(ggmm(pag[0].data)) + '</td>';
        }
        const no = isIscr ? nd.has('I') : nd.has(k.split('|')[1]);
        const ind = no ? importiNonDovuti(i).get(isIscr ? 'I' : k.split('|')[1]) : undefined;
        return '<td class="c' + (no ? ' no' : '') + (ind != null ? ' imp' : '') + '" data-cella="' + esc(so.id + '|' + c.id + '|' + (isIscr ? 'I' : k.split('|')[1])) + '" title="' + esc(label + (no ? ': da non incassare' : '') + (ind != null ? ' · € ' + eur(ind) + ' (solo nell’app)' : '')) + '">' + (ind != null ? esc(impBreve(ind)) : '') + '</td>';
      };
      h += cellaHtml('I', 'Iscrizione', true);
      mesi.forEach((ym) => { h += cellaHtml(c.id + '|' + ym, meseNome(ym), false); });
      h += '</tr>';
    });
    h += '</tbody></table></div><div class="legenda">' + Object.keys(MEZZI).map((m) => '<span><i style="background:var(--m-' + m + ')"></i>' + MEZZI[m] + '</span>').join('') + '<span><i style="background:repeating-linear-gradient(135deg,var(--grigio) 0 3px,transparent 3px 6px)"></i>da non incassare</span><span>• da inviare al foglio</span></div>';
    return h + '</div>';
  }

  // ------------------------------------------------------------------ vista: soci
  function statoCert(so) {
    if (so.scadenzaCert) {
      if (so.scadenzaCert < oggi()) return '<span class="pill bad">certificato scaduto</span>';
      if (so.scadenzaCert <= addMonths(meseCorrente(), 1) + '-31') return '<span class="pill warn">certificato in scadenza</span>';
      return '';
    }
    return so.certificato ? '' : '<span class="pill">senza certificato</span>';
  }
  function viewSoci() {
    const toks = norm(S.qSoci).split(' ').filter(Boolean);
    const f = S.fSoci || '';
    const conPag = new Set(vivi('pagamenti').filter((p) => p.esercizio === S.es).map((p) => p.socio));
    const lst = vivi('soci').filter((s) => toks.every((t) => norm(s.nominativo).includes(t)))
      .filter((s) => (f === 'senza' ? !conPag.has(s.id) : f === 'nonattivi' ? s.attivo === false : f === 'attivi' ? s.attivo !== false : true))
      .sort((a, b) => a.nominativo.localeCompare(b.nominativo, 'it'));
    let h = '<div class="stack"><div class="row" style="align-items:end"><label class="field" style="flex:3 1 220px"><span>Cerca</span><input class="in" id="cerca-soci" type="search" value="' + esc(S.qSoci) + '" placeholder="Nome o cognome"></label>' +
      '<label class="field" style="flex:1 1 180px"><span>Mostra</span><select class="in" id="soci-filtro">' + [['', 'Tutti'], ['attivi', 'Attivi'], ['nonattivi', 'Non attivi'], ['senza', 'Senza pagamenti nel ' + S.es]].map(([k, l]) => '<option value="' + k + '"' + (k === f ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>' +
      '<div style="flex:0 0 auto"><button class="btn primary" data-act="nuovo-socio">+ Nuovo socio</button></div></div>';
    h += '<div class="panel"><div class="lista">' + (lst.length ? lst.slice(0, 300).map((so) => {
      const isc = iscrizioniSocio(so.id);
      const ct = contattiHtml(so.telefono);
      return (ct ? '<div class="voce-riga">' : '') + '<button class="voce" data-socio-ed="' + esc(so.id) + '"><span class="t"><b>' + esc(so.nominativo) + (so.attivo === false ? ' <span class="pill">non attivo</span>' : '') + '</b><small>' + esc(isc.map((i) => nomeCorso(corso(i.corso))).join(', ') || 'nessun corso nel ' + S.es) + (so.telefono ? ' · ' + esc(so.telefono) : '') + '</small></span><span class="r">' + statoCert(so) + '</span></button>' + (ct ? ct + '</div>' : '');
    }).join('') : '<div class="empty">Nessun socio.</div>') + '</div></div>';
    return h + '<p class="small muted">' + lst.length + ' soci</p></div>';
  }

  // ------------------------------------------------------------------ vista: ultimi incassi
  function versamenti() {
    const map = new Map();
    vivi('pagamenti').forEach((p) => {
      const k = p.versamento || p.id;
      if (!map.has(k)) map.set(k, { id: k, data: p.data, creato: p.creato || p.modificato, socio: p.socio, nominativo: p.nominativo, mezzo: p.mezzo, righe: [], soci: [] });
      const v = map.get(k);
      v.righe.push(p);
      if (!v.soci.some((x) => x.id === p.socio)) v.soci.push({ id: p.socio, nominativo: (socio(p.socio) || {}).nominativo || p.nominativo });
    });
    return Array.from(map.values()).sort((a, b) => (b.data || '').localeCompare(a.data || '') || String(b.creato || '').localeCompare(String(a.creato || '')));
  }
  function descVersamento(v) {
    const perCorso = new Map();
    let iscr = false;
    v.righe.forEach((p) => { if (p.voce === 'iscrizione') iscr = true; else { if (!perCorso.has(p.corso)) perCorso.set(p.corso, []); perCorso.get(p.corso).push(p.mese); } });
    return [iscr ? 'iscrizione' : ''].concat(Array.from(perCorso.entries()).map(([c, m]) => nomeCorso(corso(c)) + ' ' + elencoMesi(m))).filter(Boolean).join(' · ');
  }
  function voceVersamento(v) {
    const tot = r2(v.righe.reduce((x, p) => x + importoPag(p), 0));
    const att = v.righe.some((p) => inCoda('pagamenti', p.id));
    return '<button class="voce' + (v.mezzo === 'allenatore' ? ' da-consegnare' : '') + '" data-vers="' + esc(v.id) + '"><span class="t"><b>' + esc(v.soci.map((x) => x.nominativo).join(' + ')) + (v.soci.length > 1 ? ' <span class="pill">pagamento unico</span>' : '') + '</b><small>' + esc(descVersamento(v)) + '</small></span><span class="r"><b>€ ' + eur(tot) + '</b><small class="muted">' + esc(ggmm(v.data)) + ' · ' + esc(v.mezzo === 'allenatore' ? 'all’allenatore' : MEZZI[v.mezzo] || v.mezzo || '') + (att ? ' · <span style="color:var(--amber)">da inviare</span>' : '') + '</small></span></button>';
  }
  function viewUltimi() {
    const toks = norm(S.qUltimi).split(' ').filter(Boolean);
    const lst = versamenti().filter((v) => v.righe.some((p) => p.esercizio === S.es) && toks.every((t) => v.soci.some((x) => norm(x.nominativo).includes(t))));
    let h = '<div class="stack"><label class="field"><span>Cerca</span><input class="in" id="cerca-ultimi" type="search" value="' + esc(S.qUltimi) + '" placeholder="Nome o cognome"></label>';
    if (!lst.length) return h + '<div class="panel empty">Nessun incasso nel ' + esc(S.es) + '.</div></div>';
    let tot = 0;
    const dc = versamenti().filter((v) => v.mezzo === 'allenatore' && v.righe.some((p) => p.esercizio === S.es));
    if (dc.length) {
      const t2 = r2(dc.reduce((x, v) => x + v.righe.reduce((y, p) => y + importoPag(p), 0), 0));
      h += '<div class="msg err">Contanti ancora presso gli allenatori: € ' + eur(t2) + ' in ' + dc.length + (dc.length === 1 ? ' incasso' : ' incassi') + ' (in rosso). Quando il denaro arriva in cassa, apri l’incasso e premi «Consegnato in cassa».</div>';
    }
    h += '<div class="panel"><div class="lista">';
    let giorno = null;
    lst.slice(0, 200).forEach((v) => {
      if (v.data !== giorno) { giorno = v.data; h += '<div class="gruppo-data">' + esc(new Date(v.data + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })) + '</div>'; }
      h += voceVersamento(v);
    });
    lst.forEach((v) => v.righe.forEach((p) => { tot += importoPag(p); }));
    return h + '</div></div><p class="small muted">' + lst.length + ' incassi · € ' + eur(tot) + (lst.length > 200 ? ' · mostrati gli ultimi 200' : '') + '</p></div>';
  }

  // ------------------------------------------------------------------ vista: cruscotto (dal Bilancio)
  // Il Bilancio, all'apertura sul PC collegato al Foglio Google, vi lascia una copia del suo cruscotto
  // (risultati, fondi, cassa e banca); l'app la riceve quando si sincronizza.
  function viewCruscotto() {
    const D = S.cr;
    if (!D) return '<div class="panel pad stack"><h2>Cruscotto</h2><p class="muted" style="margin:0">Il cruscotto arriva dal programma Bilancio: compare qui dopo che il Bilancio, sul PC collegato a questo Foglio Google, è stato aperto' + (S.versioneFoglio && S.versioneFoglio < 2 ? '. Prima va aggiornato lo script del Foglio Google (vedi il manuale).' : '.') + '</p></div>';
    const segno = (v) => (v < -0.004 ? ' neg' : '');
    const quando = D.creato ? new Date(D.creato) : null;
    const giorni = quando ? Math.floor((Date.now() - quando.getTime()) / 86400000) : 0;
    const quandoT = quando ? (quando.toDateString() === new Date().toDateString() ? 'oggi' : 'il ' + quando.toLocaleDateString('it-IT')) + ' alle ' + quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const card = (t, v, sotto) => '<div class="cr-card"><span>' + esc(t) + '</span><b class="' + segno(v) + '">€ ' + eur(v) + '</b><small>' + sotto + '</small></div>';
    let h = '<div class="stack">';
    h += '<div><h2 class="cr-tit">Cruscotto</h2><p class="small muted" style="margin:2px 0 0">Dati del Bilancio, esercizio ' + esc(D.es) + ': aggiornati ' + esc(quandoT) + (D.ultimaData ? ', ultima registrazione del ' + esc(fmtData(D.ultimaData)) : '') + '.' +
      (giorni >= 1 ? ' <span class="pill warn">di ' + (giorni === 1 ? 'ieri' : giorni + ' giorni fa') + '</span>' : '') + '</p></div>';
    if (D.es !== S.es) h += '<div class="msg warn">Il cruscotto è dell’esercizio ' + esc(D.es) + '; in alto è scelto il ' + esc(S.es) + '.</div>';
    h += '<div class="cr-cards">' +
      card('Risultato d’esercizio', D.risultato, (D.risultato >= 0 ? 'avanzo' : 'disavanzo') + ': ricavi € ' + eur(D.ricavi) + ' − costi € ' + eur(D.costi)) +
      card('Risultato kung fu', D.risultatoKungFu, 'risultato − fondo basket − fondo Acqui Terme') +
      card('Fondo disponibile basket', D.basket.fondo, 'saldo € ' + eur(D.basket.saldo) + ' − trattenuta ' + esc(String(D.basket.perc).replace('.', ',')) + '% € ' + eur(D.basket.trattenuta)) +
      card('Fondo Scuola Acqui Terme', D.acqui.fondo, 'saldo € ' + eur(D.acqui.saldo) + ' − trattenuta ' + esc(String(D.acqui.perc).replace('.', ',')) + '% € ' + eur(D.acqui.trattenuta)) +
      '</div>';
    const riga = (l, v, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + l + '</td><td class="num">' + v + '</td></tr>';
    const Ca = D.cassa, B = D.banca;
    h += '<div class="panel pad stack"><h2 class="sez">Cash flow</h2><div class="cr-cf">' +
      '<div><h3>Cassa <small>contanti</small></h3><table class="cr-t">' + riga('Saldo iniziale', eur(Ca.iniziale)) + riga('Entrate', '+ ' + eur(Ca.entrate)) + riga('Uscite', '− ' + eur(Ca.uscite)) +
      riga('Cassa da contabilità', eur(Ca.saldo), 'tot') + riga('Denaro in mano agli allenatori' + (Ca.nPresso ? ' (' + Ca.nPresso + ')' : ''), Ca.presso ? '− ' + eur(Ca.presso) : '-', 'rosso') + '</table>' +
      '<div class="cr-big"><span>Cassa disponibile</span><b class="' + segno(Ca.disponibile) + '">€ ' + eur(Ca.disponibile) + '</b></div></div>' +
      '<div><h3>Banca <small>banca, PayPal, SumUp</small></h3><table class="cr-t">' + riga('Saldo iniziale', eur(B.iniziale)) + riga('Entrate', '+ ' + eur(B.entrate)) + riga('Uscite', '− ' + eur(B.uscite)) + '</table>' +
      '<div class="cr-big"><span>Banca</span><b class="' + segno(B.saldo) + '">€ ' + eur(B.saldo) + '</b></div></div>' +
      '</div><div class="cr-tot"><span>Totale disponibile</span><b>€ ' + eur(D.disponibile) + '</b></div></div>';
    return h + '</div>';
  }

  // ------------------------------------------------------------------ quote da pagare su WhatsApp
  // Ogni destinatario ha un telefono e uno o più corsi. Per ogni corso l'app disegna una tabella JPEG su sfondo
  // bianco (da stampare) con le sole quote non pagate fino al mese in corso. Il lunedì ricorda di inviarle:
  // un tocco apre la condivisione del telefono (WhatsApp, poi il contatto). Le impostazioni restano su questo
  // dispositivo, così il promemoria compare solo qui e non sui telefoni degli allenatori.
  function lunediDi(iso) {
    const d = new Date(iso.slice(0, 10) + 'T12:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  const invii = () => (Array.isArray(S.conf.invii) ? S.conf.invii : []);
  const invio = (id) => invii().find((x) => x.id === id) || null;
  const corsiInvio = (inv) => (inv.corsi || []).map(corso).filter((c) => c && !c.eliminato);
  // destinatari proposti: basket Mandrogne da una parte, basket Spinetta (elementari e medie) dall'altra
  function inviiProposti() {
    const cs = corsi().filter((c) => c.attivo !== false);
    const nome = (c) => String(c.nome || '') + ' ' + String(c.titolo || '');
    const mandrogne = cs.filter((c) => /mandrogn/i.test(nome(c)) || /^\s*basket\s+m\s*$/i.test(c.nome));
    const spinetta = cs.filter((c) => /basket/i.test(nome(c)) && (/spinett/i.test(nome(c)) || /\bsm\b/i.test(c.nome)));
    const out = [];
    out.push({ id: uid('w'), ruolo: 'mandrogne', nome: 'Basket Mandrogne', tel: '', corsi: mandrogne.map((c) => c.id), ultimo: null });
    out.push({ id: uid('w'), ruolo: 'spinetta', nome: 'Basket Spinetta', tel: '', corsi: spinetta.map((c) => c.id), ultimo: null });
    return out;
  }
  // i due destinatari fissi: corsi di Mandrogne da una parte, Spinetta elementari e medie dall'altra
  const RUOLI = [['mandrogne', 'Corsi di Mandrogne'], ['spinetta', 'Spinetta elementari e medie']];
  const invioRuolo = (r) => invii().find((x) => x.ruolo === r) || invii().find((x) => !x.ruolo && new RegExp(r, 'i').test(x.nome || '')) || null;
  // procedura iniziale: si scrivono i due numeri, che restano questi finché non li cambi
  function dlgNumeri() {
    const d = S.dialog;
    const prop = inviiProposti();
    let h = '<h3>Numeri WhatsApp per le quote da pagare</h3>' +
      '<p class="small muted" style="margin:0">Scrivi i numeri a cui mandare ogni lunedì le tabelle delle quote ancora da pagare. Restano questi, su questo dispositivo, finché non li cambi.</p>';
    RUOLI.forEach(([r, etichetta]) => {
      const inv = invioRuolo(r);
      const cs = inv && corsiInvio(inv).length ? corsiInvio(inv) : (prop.find((x) => x.ruolo === r).corsi || []).map(corso).filter(Boolean);
      const v = d.v[r] !== undefined ? d.v[r] : (inv && inv.tel) || '';
      h += '<label class="field"><span>' + esc(etichetta) + '</span><input class="in" type="tel" inputmode="tel" data-numero="' + r + '" value="' + esc(v) + '" placeholder="es. 333 1234567"' + (r === 'mandrogne' ? ' autofocus' : '') + '>' +
        '<small class="muted">' + (cs.length ? 'Tabelle: ' + esc(cs.map((c) => c.nome).join(', ')) + (cs.length > 1 ? ' (una per corso)' : '') : 'Nessun corso trovato: sceglilo poi in Altro.') + '</small></label>';
    });
    if (d.err) h += '<div class="msg err">' + esc(d.err) + '</div>';
    return h + '<div class="azioni"><button class="btn ghost" data-act="chiudi">Annulla</button><button class="btn primary" data-act="numeri-salva">Salva i numeri</button></div>';
  }
  function salvaNumeri() {
    const d = S.dialog;
    const val = {};
    for (const [r, etichetta] of RUOLI) {
      const el = $('[data-numero="' + r + '"]');
      const t = ((el && el.value) || '').trim();
      if (t && !numeroTel(t)) { d.err = 'Il numero per «' + etichetta + '» non sembra valido.'; d.v[r] = t; renderDialog(); return; }
      val[r] = t;
    }
    if (!val.mandrogne && !val.spinetta) { d.err = 'Scrivi almeno un numero.'; renderDialog(); return; }
    const prop = inviiProposti();
    const lista = invii().slice();
    RUOLI.forEach(([r]) => {
      let inv = invioRuolo(r);
      if (!inv) { inv = prop.find((x) => x.ruolo === r); lista.push(inv); }
      inv.ruolo = r;
      inv.tel = val[r];
    });
    S.conf.invii = lista;
    S.dialog = null; salva(); render();
    toast('Numeri salvati: ' + RUOLI.filter(([r]) => val[r]).map(([r, e]) => e + ' ' + val[r]).join(' · ') + '.');
  }
  // quote non pagate di un corso, dall'inizio dell'anno sportivo al mese in corso (iscrizione compresa)
  function quoteDaPagare(c) {
    const es = esCorrente(), ora = meseCorrente();
    const mesi = mesiCorso(c, es).filter((ym) => ym <= ora);
    const qIscr = Number(S.conf.quotaIscrizione) || 0;
    const righe = [];
    iscrizioniCorso(c.id, es).forEach((i) => {
      const so = socio(i.socio);
      const st = situazione(so.id, es);
      const nd = nonDovuti(i);
      const q = quotaIsc(i);
      const iscr = !st.iscrPagata && !st.iscrNonDovuta ? qIscr : 0;
      const m = mesi.map((ym) => (st.cell.has(c.id + '|' + ym) || nd.has(ym) ? 0 : q));
      const tot = r2(iscr + m.reduce((a, b) => a + b, 0));
      if (tot > 0.004) righe.push({ nome: so.nominativo, iscr, mesi: m, tot });
    });
    righe.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    const conIscr = righe.some((r) => r.iscr > 0);
    return { corso: c, es, ora, mesi, righe, conIscr, totale: r2(righe.reduce((a, r) => a + r.tot, 0)) };
  }
  // la tabella come immagine: sfondo bianco, testo nero, righe sottili, pronta per la stampa
  function disegnaQuote(T) {
    const M = 56, rowH = 46, font = 'Arial, Helvetica, sans-serif';
    const cv = document.createElement('canvas');
    let ctx = cv.getContext('2d');
    ctx.font = '22px ' + font;
    const lungo = T.righe.reduce((w, r) => Math.max(w, ctx.measureText(r.nome).width), ctx.measureText('Socio').width);
    const wNome = Math.min(520, Math.max(300, Math.ceil(lungo) + 28));
    const cols = [{ t: 'N.', w: 56, al: 'right' }, { t: 'Socio', w: wNome, al: 'left' }]
      .concat(T.conIscr ? [{ t: 'Iscr.', w: 86, al: 'center' }] : [])
      .concat(T.mesi.map((ym) => ({ t: mese3(ym).charAt(0).toUpperCase() + mese3(ym).slice(1), w: 86, al: 'center', ora: ym === T.ora })))
      .concat([{ t: 'Totale', w: 124, al: 'right' }]);
    const wTab = cols.reduce((a, c) => a + c.w, 0);
    const W = Math.max(1000, wTab + 2 * M);
    const x0 = Math.round((W - wTab) / 2);
    const nR = Math.max(1, T.righe.length);
    const H = M + 112 + rowH + nR * rowH + (T.righe.length ? rowH : 0) + 70 + M;
    const K = 2; // doppia risoluzione: la stampa resta nitida
    cv.width = W * K; cv.height = H * K;
    ctx = cv.getContext('2d');
    ctx.scale(K, K);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px ' + font; ctx.textAlign = 'left';
    ctx.fillText(titoloCorso(T.corso).toUpperCase(), x0, M + 18);
    ctx.font = '22px ' + font; ctx.fillStyle = '#333333';
    ctx.fillText('Quote da pagare al ' + fmtData(oggi()) + ' (fino a ' + meseNome(T.ora) + ') · anno sportivo ' + T.es, x0, M + 62);
    let y = M + 112;
    const cella = (txt, c, x, yy, bold) => {
      ctx.font = (bold ? 'bold ' : '') + '22px ' + font; ctx.fillStyle = '#000000';
      let t = String(txt);
      const max = c.w - 20;
      if (ctx.measureText(t).width > max) { while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1); t += '…'; }
      ctx.textAlign = c.al === 'right' ? 'right' : c.al === 'center' ? 'center' : 'left';
      ctx.fillText(t, c.al === 'right' ? x + c.w - 10 : c.al === 'center' ? x + c.w / 2 : x + 10, yy + rowH / 2 + 1);
    };
    const riga = (valori, yy, opz) => {
      const o = opz || {};
      if (o.fondo) { ctx.fillStyle = o.fondo; ctx.fillRect(x0, yy, wTab, rowH); }
      let x = x0;
      cols.forEach((c, k) => { if (valori[k] !== '' && valori[k] != null) cella(valori[k], c, x, yy, o.bold); x += c.w; });
    };
    const imp = (v) => (v > 0.004 ? impBreve(v) : '');
    // intestazione
    riga(cols.map((c) => c.t), y, { fondo: '#e4e4e4', bold: true });
    const yTab = y;
    y += rowH;
    if (!T.righe.length) {
      ctx.font = 'italic 22px ' + font; ctx.fillStyle = '#000000'; ctx.textAlign = 'center';
      ctx.fillText('Nessuna quota da pagare', x0 + wTab / 2, y + rowH / 2 + 1);
      y += rowH;
    }
    T.righe.forEach((r, k) => {
      riga([k + 1, r.nome].concat(T.conIscr ? [imp(r.iscr)] : []).concat(r.mesi.map(imp)).concat([eur(r.tot)]), y, { fondo: k % 2 ? '#f3f3f3' : null });
      y += rowH;
    });
    if (T.righe.length) {
      const tm = T.mesi.map((_, j) => r2(T.righe.reduce((a, r) => a + r.mesi[j], 0)));
      const ti = r2(T.righe.reduce((a, r) => a + r.iscr, 0));
      riga(['', 'Totale (' + T.righe.length + (T.righe.length === 1 ? ' socio)' : ' soci)')].concat(T.conIscr ? [imp(ti)] : []).concat(tm.map(imp)).concat([eur(T.totale)]), y, { fondo: '#e4e4e4', bold: true });
      y += rowH;
    }
    // griglia
    ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1;
    for (let yy = yTab; yy <= y + 0.5; yy += rowH) { ctx.beginPath(); ctx.moveTo(x0, yy + 0.5); ctx.lineTo(x0 + wTab, yy + 0.5); ctx.stroke(); }
    let x = x0;
    cols.forEach((c) => { ctx.beginPath(); ctx.moveTo(x + 0.5, yTab); ctx.lineTo(x + 0.5, y); ctx.stroke(); x += c.w; });
    ctx.beginPath(); ctx.moveTo(x0 + wTab - 0.5, yTab); ctx.lineTo(x0 + wTab - 0.5, y); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000000';
    ctx.strokeRect(x0, yTab, wTab, y - yTab);
    if (T.righe.length) { ctx.beginPath(); ctx.moveTo(x0, y - rowH); ctx.lineTo(x0 + wTab, y - rowH); ctx.stroke(); }
    ctx.font = '19px ' + font; ctx.fillStyle = '#444444'; ctx.textAlign = 'left';
    ctx.fillText('Importi in euro.' + (T.conIscr ? ' Iscr. = quota di iscrizione.' : '') + ' Le caselle vuote sono pagate o da non incassare.', x0, y + 36);
    return cv;
  }
  const blobDa = (cv, tipo, q) => new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error('Immagine non creata.'))), tipo, q));
  async function immaginiInvio(inv) {
    const out = [];
    for (const c of corsiInvio(inv)) {
      const T = quoteDaPagare(c);
      const cv = disegnaQuote(T);
      const blob = await blobDa(cv, 'image/jpeg', 0.92);
      const nome = 'Quote da pagare ' + String(c.nome).replace(/[\\/:*?"<>|]/g, '') + ' ' + oggi() + '.jpg';
      out.push({ corso: c, T, cv, blob, file: new File([blob], nome, { type: 'image/jpeg' }), nome });
    }
    return out;
  }
  const testoInvio = (inv, imm) => 'Quote da pagare al ' + fmtData(oggi()) + ': ' + imm.map((x) => titoloCorso(x.corso) + (x.T.righe.length ? ' € ' + eur(x.T.totale) : ' nessuna')).join(' · ');
  function segnaInviato(inv) { inv.ultimo = lunediDi(oggi()); salva(); render(); }
  const puoCondividere = (files) => { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files })); } catch (e) { return false; } };
  // un tocco: condivisione del telefono con le immagini; senza condivisione (alcuni PC) si apre l'anteprima
  async function inviaQuote(id) {
    const inv = invio(id);
    if (!inv) return;
    if (!corsiInvio(inv).length) { toast('Scegli prima i corsi di «' + inv.nome + '» in Altro.', 'err'); vai('altro'); return; }
    if (!numeroTel(inv.tel)) { apri({ tipo: 'numeri', v: {} }); return; }
    let imm;
    try { imm = await immaginiInvio(inv); } catch (e) { toast(e.message || 'Immagine non creata.', 'err'); return; }
    const files = imm.map((x) => x.file);
    if (!puoCondividere(files)) { apriAnteprima(inv, imm); return; }
    try {
      await navigator.share({ files, text: testoInvio(inv, imm) });
      segnaInviato(inv);
      toast('Quote di «' + inv.nome + '» inviate.');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // condivisione annullata
      apriAnteprima(inv, imm); // per esempio il tocco è «scaduto» mentre l'immagine si preparava
    }
  }
  function apriAnteprima(inv, imm) {
    if (S.dialog && S.dialog.tipo === 'quote') (S.dialog.url || []).forEach((u) => URL.revokeObjectURL(u));
    apri({ tipo: 'quote', id: inv.id, imm, url: imm.map((x) => URL.createObjectURL(x.blob)) });
  }
  async function anteprimaQuote(id) {
    const inv = invio(id);
    if (!inv) return;
    if (!corsiInvio(inv).length) { toast('Scegli prima almeno un corso.', 'err'); return; }
    try { apriAnteprima(inv, await immaginiInvio(inv)); } catch (e) { toast(e.message || 'Immagine non creata.', 'err'); }
  }
  function dlgQuote() {
    const d = S.dialog, inv = invio(d.id);
    if (!inv) return '<h3>Destinatario non trovato</h3><div class="azioni"><button class="btn ghost" data-act="chiudi">Chiudi</button></div>';
    const files = d.imm.map((x) => x.file);
    const share = puoCondividere(files);
    const n = numeroTel(inv.tel);
    let h = '<h3>Quote da pagare · ' + esc(inv.nome) + '</h3>' +
      '<p class="small muted" style="margin:0">' + (inv.tel ? 'Per ' + esc(inv.tel) + '. ' : '') + (share ? 'Premi «Invia su WhatsApp», scegli WhatsApp e il contatto.' : 'Su questo dispositivo l’app non può passare le immagini a WhatsApp: copia una tabella, apri la chat, incolla (Ctrl+V) e invia; poi la successiva. Oppure scaricale e allegale.') + '</p>';
    d.imm.forEach((x, k) => {
      h += '<figure class="inv-img"><img src="' + d.url[k] + '" alt="Tabella quote da pagare ' + esc(x.corso.nome) + '"><figcaption><b>' + esc(titoloCorso(x.corso)) + '</b> · ' + (x.T.righe.length ? x.T.righe.length + (x.T.righe.length === 1 ? ' socio' : ' soci') + ', € ' + eur(x.T.totale) : 'nessuna quota da pagare') +
        '<span class="inv-az">' + (!share && navigator.clipboard && window.ClipboardItem ? '<button class="btn sm" data-inv-copia="' + k + '">Copia</button>' : '') + '<button class="btn sm ghost" data-inv-scarica="' + k + '">Scarica</button></span></figcaption></figure>';
    });
    h += '<div class="azioni"><button class="btn ghost" data-act="chiudi">Chiudi</button>' + (share ? '<button class="btn primary" data-inv-condividi="' + esc(inv.id) + '">Invia su WhatsApp</button>' :
      (n ? '<a class="btn primary" href="https://wa.me/' + n + '" target="_blank" rel="noopener">Apri la chat WhatsApp</a>' : '') + '<button class="btn" data-inv-fatto="' + esc(inv.id) + '">Segna come inviato</button>') + '</div>';
    return h;
  }
  // promemoria del lunedì: resta finché le quote della settimana non sono state inviate
  function bannerInvii() {
    const lun = lunediDi(oggi());
    const da = invii().filter((x) => corsiInvio(x).length && numeroTel(x.tel) && (x.ultimo || '') < lun);
    if (!da.length) return '';
    return '<div class="panel pad inv-banner"><div><b>Quote da pagare: invio del lunedì</b><div class="small muted">Tabelle con le quote non pagate fino a ' + esc(meseNome(meseCorrente())) + ', da mandare su WhatsApp.</div></div>' +
      '<div class="row">' + da.map((x) => '<button class="btn primary" data-inv-invia="' + esc(x.id) + '">' + ICONA_MSG + esc(x.nome) + '</button>').join('') +
      '<button class="btn ghost sm" data-act="inv-salta" title="Nasconde il promemoria fino a lunedì prossimo">Non questa settimana</button></div></div>';
  }
  function inviiHtml() {
    const lista = invii();
    const cs = corsi().filter((c) => c.attivo !== false);
    let h = '<div class="panel pad stack"><h2 class="sez">Quote da pagare su WhatsApp</h2>' +
      '<p class="small muted" style="margin:0">Per ogni destinatario, una tabella JPEG per corso (sfondo bianco, da stampare) con le sole quote non pagate fino al mese in corso. Ogni lunedì, finché non le invii, in Incassa e in Corsi compare il promemoria: un tocco apre la condivisione, scegli WhatsApp e il contatto. Queste impostazioni valgono solo per questo dispositivo.</p>';
    if (!lista.length) return h + '<div><button class="btn primary" data-act="inv-numeri">Inserisci i numeri WhatsApp</button></div></div>';
    h += '<div class="inv-numeri">' + RUOLI.map(([r, e]) => { const x = invioRuolo(r); return '<div><span class="small muted">' + esc(e) + '</span><b>' + esc((x && x.tel) || 'nessun numero') + '</b></div>'; }).join('') +
      '<button class="btn sm" data-act="inv-numeri">Cambia i numeri</button></div>';
    lista.forEach((x) => {
      h += '<div class="inv-card stack" data-inv-id="' + esc(x.id) + '"><div class="row">' +
        '<label class="field"><span>Destinatario</span><input class="in" data-inv="' + esc(x.id) + '|nome" value="' + esc(x.nome) + '"></label>' +
        '<label class="field"><span>Telefono WhatsApp</span><input class="in" type="tel" inputmode="tel" data-inv="' + esc(x.id) + '|tel" value="' + esc(x.tel || '') + '" placeholder="es. 333 1234567"></label></div>' +
        '<div><div class="small muted" style="margin-bottom:6px">Corsi (una tabella per corso)</div><div class="inv-corsi">' + cs.map((c) => '<button class="inv-chip' + ((x.corsi || []).includes(c.id) ? ' on' : '') + '" data-inv-corso="' + esc(x.id + '|' + c.id) + '" aria-pressed="' + (x.corsi || []).includes(c.id) + '">' + esc(c.nome) + '</button>').join('') + '</div></div>' +
        (x.tel && !numeroTel(x.tel) ? '<div class="msg err">Il numero non sembra valido.</div>' : '') +
        '<div class="row" style="align-items:center"><button class="btn sm" data-inv-anteprima="' + esc(x.id) + '">Anteprima</button><button class="btn sm primary" data-inv-invia="' + esc(x.id) + '">Invia ora</button><button class="btn sm ghost" data-inv-del="' + esc(x.id) + '">Elimina</button>' +
        '<span class="small muted">' + (x.ultimo ? 'Inviato la settimana del ' + esc(fmtData(x.ultimo)) : 'Mai inviato') + '</span></div></div>';
    });
    return h + '<div><button class="btn sm" data-act="inv-nuovo">+ Nuovo destinatario</button></div></div>';
  }

  // ------------------------------------------------------------------ vista: altro (impostazioni)
  function viewAltro() {
    const c = S.conf;
    let h = '<div class="stack">';
    h += '<div class="panel pad stack"><h2 class="sez">Foglio Google</h2>' +
      '<p class="small muted" style="margin:0">Indirizzo dell’app web (finisce con <code>/exec</code>) e chiave di accesso, che trovi nel foglio «Configurazione».</p>' +
      '<label class="field"><span>URL dell’app web</span><input class="in" id="c-url" value="' + esc(c.url) + '" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>' +
      '<label class="field"><span>Chiave di accesso</span><input class="in" id="c-chiave" value="' + esc(c.chiave) + '" autocomplete="off"></label>' +
      '<div class="row"><button class="btn primary" data-act="collega">Salva e sincronizza</button>' + (collegato() ? '<button class="btn" data-act="link-collega">Collega un altro dispositivo</button>' : '') + '</div>' +
      (S.sync.errore ? '<div class="msg err">' + esc(S.sync.errore) + '</div>' : collegato() && S.sync.ultima ? '<div class="msg ok">Ultima sincronizzazione: ' + esc(new Date(S.sync.ultima).toLocaleString('it-IT')) + (S.coda.length ? ' · ' + S.coda.length + ' modifiche da inviare' : '') + '</div>' : '') +
      '</div>';
    h += '<div class="panel pad stack"><h2 class="sez">Questo dispositivo</h2><div class="row"><label class="field"><span>Nome del dispositivo</span><input class="in" id="c-disp" value="' + esc(c.dispositivo) + '"></label>' +
      '<label class="field"><span>Quota di iscrizione €</span><input class="in num" id="c-iscr" inputmode="decimal" value="' + esc(String(c.quotaIscrizione).replace('.', ',')) + '"></label></div><div><button class="btn" data-act="salva-conf">Salva</button></div></div>';
    h += inviiHtml();
    h += '<div class="panel pad stack"><h2 class="sez">Corsi</h2><div class="lista" style="margin:0 -16px">' + corsi().map((x) => '<button class="voce" data-corso-ed="' + esc(x.id) + '"><span class="t"><b>' + esc(x.nome) + (x.attivo === false ? ' <span class="pill">non attivo</span>' : '') + '</b><small>' + esc(x.titolo || '') + ' · ' + String(x.mesi || '').length + ' mesi</small></span><span class="r"><b>€ ' + eur(x.quota) + '</b><small class="muted">al mese</small></span></button>').join('') + '</div><div><button class="btn" data-act="nuovo-corso">+ Nuovo corso</button></div></div>';
    h += '<div class="panel pad stack"><h2 class="sez">Registro Excel</h2><p class="small muted" style="margin:0">Importa corsi, soci, pagamenti, mesi grigi e certificati dal file del registro (si fa una volta sola, dal PC). Le celle rosse e quelle senza una data valida non vengono importate.</p><div><label class="btn">Importa il registro Excel<input type="file" id="imp-xlsx" accept=".xlsx" hidden></label></div></div>';
    h += '<div class="panel pad stack"><h2 class="sez">Copia dei dati</h2><p class="small muted" style="margin:0">Scarica tutto l’archivio in un file: il Bilancio lo può leggere anche senza collegamento al foglio.</p><div class="row"><button class="btn" data-act="esporta">Scarica l’archivio (.json)</button>' + (collegato() ? '<button class="btn" data-act="ricarica">Riscarica tutto dal foglio</button>' : '') + '</div></div>';
    h += '<p class="small muted">Registro pagamenti · versione ' + esc(VERSIONE_APP) + ' · ' + vivi('soci').length + ' soci, ' + vivi('pagamenti').length + ' pagamenti</p>';
    return h + '</div>';
  }

  // ------------------------------------------------------------------ finestre
  function apri(d) { S.dialog = d; renderDialog(); }
  function chiudi() { if (S.dialog && S.dialog.tipo === 'quote') (S.dialog.url || []).forEach((u) => URL.revokeObjectURL(u)); S.dialog = null; renderDialog(); }
  function renderDialog() {
    const box = $('#dialog');
    if (!S.dialog) { box.innerHTML = ''; box.hidden = true; document.body.style.overflow = ''; return; }
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    const d = S.dialog;
    const html = { cella: dlgCella, socio: dlgSocio, iscrivi: dlgIscrivi, versamento: dlgVersamento, corso: dlgCorso, importa: dlgImporta, collega: dlgCollega, quote: dlgQuote, numeri: dlgNumeri }[d.tipo]();
    box.innerHTML = '<div class="velo" data-chiudi><div class="dialog" role="dialog" aria-modal="true">' + html + '</div></div>';
    const f = box.querySelector('[autofocus]');
    if (f) f.focus();
  }

  function dlgCella() {
    const { sid, cid, mese } = S.dialog;
    const so = socio(sid), c = corso(cid);
    const isc = iscrizioniSocio(sid).find((i) => i.corso === cid);
    const st = situazione(sid);
    const pag = mese === 'I' ? st.cell.get('I') || [] : st.cell.get(cid + '|' + mese) || [];
    const nd = nonDovuti(isc);
    const label = mese === 'I' ? 'Iscrizione ' + S.es : meseNome(mese);
    let h = '<h3>' + esc(so.nominativo) + '</h3><div class="muted">' + esc(label) + ' · ' + esc(titoloCorso(c)) + '</div>';
    if (pag.length) {
      h += pag.map((p) => '<div class="panel pad small' + (p.mezzo === 'allenatore' ? ' da-consegnare' : '') + '"><b>Pagato il ' + esc(fmtData(p.data)) + '</b> · ' + esc(nomeMezzo(p.mezzo)) + ' · € ' + eur(importoPag(p)) + (p.importo == null ? ' (quota)' : '') + (p.voce === 'iscrizione' && p.corso !== cid ? ' · registrata su ' + esc(nomeCorso(corso(p.corso))) : '') + '<div class="muted">' + esc([p.nota, p.dispositivo ? 'da ' + p.dispositivo : '', inCoda('pagamenti', p.id) ? 'da inviare al foglio' : ''].filter(Boolean).join(' · ')) + '</div>' +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' + (p.mezzo === 'allenatore' ? '<button class="btn sm primary" data-consegna="' + esc(p.versamento || p.id) + '">Consegnato in cassa</button>' : '') + '<button class="btn sm danger" data-elimina-pag="' + esc(p.id) + '">Elimina questo pagamento</button></div></div>').join('');
    } else if (nd.has(mese) || S.dialog.grigio) {
      // da non incassare, con un importo facoltativo che resta solo nell'app
      const ind = importiNonDovuti(isc).get(mese);
      const gia = nd.has(mese);
      h += '<div class="msg warn">' + (mese === 'I' ? 'Iscrizione' : 'Mese') + ' da non incassare' + (gia && ind != null ? ' · € ' + eur(ind) : '') + '.</div>' +
        '<label class="field"><span>Importo (facoltativo)</span><input class="in" id="nd-imp" inputmode="decimal" placeholder="nessun importo" value="' + esc(ind != null ? String(ind).replace('.', ',') : '') + '"' + (gia ? '' : ' autofocus') + '></label>' +
        '<p class="small muted" style="margin:0">L’importo compare nella casella al posto della data e resta solo in quest’app: al Bilancio arriva il mese da non incassare, senza importo.</p>' +
        '<div class="azioni">' + (gia ? '<button class="btn" data-grigio="0">Togli il grigio</button><button class="btn primary" data-act="grigio-ok">Salva l’importo</button>' : '<button class="btn" data-act="grigio-annulla">Annulla</button><button class="btn primary" data-act="grigio-ok">Da non incassare</button>') + '</div>';
    } else {
      h += '<div class="azioni"><button class="btn" data-act="grigio-chiedi">Da non incassare (grigio)</button><button class="btn primary" data-act="incassa-cella">Incassa</button></div>';
    }
    return h + '<div class="azioni"><button class="btn ghost" data-act="chiudi">Chiudi</button></div>';
  }

  function dlgSocio() {
    const d = S.dialog;
    const so = d.sid ? socio(d.sid) : null;
    const v = d.v || (d.v = so ? { nominativo: so.nominativo, cognome: so.cognome || '', nome: so.nome || '', telefono: so.telefono || '', certificato: !!so.certificato, scadenzaCert: so.scadenzaCert || '', note: so.note || '', attivo: so.attivo !== false, corsi: {} } : { cognome: '', nome: '', telefono: '', certificato: false, scadenzaCert: '', note: '', attivo: true, corsi: {} });
    let h = '<h3>' + (so ? esc(so.nominativo) : 'Nuovo socio') + '</h3>';
    if (so && !so.cognome) {
      h += '<label class="field"><span>Nominativo</span><input class="in" data-v="nominativo" value="' + esc(v.nominativo) + '"></label>';
    } else {
      h += '<div class="row"><label class="field"><span>Cognome</span><input class="in" data-v="cognome" value="' + esc(v.cognome) + '" autocapitalize="words"' + (so ? '' : ' autofocus') + '></label><label class="field"><span>Nome</span><input class="in" data-v="nome" value="' + esc(v.nome) + '" autocapitalize="words"></label></div>';
    }
    h += '<div class="row"><label class="field"><span>Telefono</span><input class="in" data-v="telefono" type="tel" value="' + esc(v.telefono) + '"></label><label class="field"><span>Scadenza certificato medico</span><input class="in" type="date" data-v="scadenzaCert" value="' + esc(v.scadenzaCert) + '"></label></div>' +
      '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-v="certificato"' + (v.certificato ? ' checked' : '') + '> Certificato medico consegnato</label>';
    if (so && numeroTel(so.telefono)) h += contattiHtml(so.telefono, true);
    // corsi dell'anno
    const isc = so ? iscrizioniSocio(so.id) : [];
    const giaIsc = new Set(isc.map((i) => i.corso));
    h += '<div class="field"><span>Corsi ' + esc(S.es) + '</span>';
    if (so) {
      h += isc.length ? isc.map((i) => '<div class="ri" style="grid-template-columns:minmax(0,1fr) 110px auto"><div><b>' + esc(nomeCorso(corso(i.corso))) + '</b><small>' + esc(titoloCorso(corso(i.corso))) + '</small></div><input class="in num" inputmode="decimal" data-quota-isc="' + esc(i.id) + '" value="' + esc(i.quota != null ? String(i.quota).replace('.', ',') : '') + '" placeholder="' + esc(String(corso(i.corso).quota).replace('.', ',')) + '" aria-label="Quota mensile personale"><button class="btn sm danger" data-togli-isc="' + esc(i.id) + '" title="Togli dal corso">✕</button></div>').join('') + '<small class="muted">Quota mensile: lascia vuoto per usare quella del corso.</small>' : '<div class="muted small">Nessun corso.</div>';
    }
    const altri = corsiAttivi().filter((c) => !giaIsc.has(c.id));
    if (altri.length) h += '<div class="seg" style="margin-top:6px">' + altri.map((c) => '<button type="button" data-corso-sc="' + esc(c.id) + '" class="' + (v.corsi[c.id] ? 'on' : '') + '" aria-pressed="' + !!v.corsi[c.id] + '">' + (so ? '+ ' : '') + esc(c.nome) + '</button>').join('') + '</div>';
    h += '</div><label class="field"><span>Note</span><textarea class="in" data-v="note">' + esc(v.note) + '</textarea></label>';
    if (so) h += '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-v="attivo"' + (v.attivo ? ' checked' : '') + '> Socio attivo</label>';
    if (so) h += togliSocioHtml(so, isc);
    if (d.err) h += '<div class="msg err">' + esc(d.err) + '</div>';
    h += '<div class="azioni"><button class="btn ghost" data-act="chiudi">Annulla</button>' + (so ? '<button class="btn" data-act="socio-incassa">Incassa</button>' : '') + '<button class="btn primary" data-act="salva-socio">' + (so ? 'Salva' : d.perIncasso ? 'Crea e continua' : 'Crea il socio') + '</button></div>';
    return h;
  }
  // togliere un socio: «ha smesso» (i mesi da un certo mese in poi diventano da non incassare, i pagamenti restano)
  // oppure eliminarlo dall'app, solo se non ha nessun pagamento (inserito per errore, doppio, mai venuto)
  function togliSocioHtml(so, isc) {
    const d = S.dialog;
    const np = vivi('pagamenti').filter((p) => p.socio === so.id).length;
    const mesi = mesiEs(S.es);
    const ora = meseCorrente();
    const def = mesi.includes(ora) ? ora : mesi[0];
    let h = '<details class="togli"' + (d.togliAperto ? ' open' : '') + '><summary>Togli il socio</summary><div class="stack" style="gap:10px;margin-top:10px">';
    if (isc.length) {
      h += '<div><b>Ha smesso di frequentare</b><p class="small muted" style="margin:2px 0 8px">Dal mese scelto in poi i mesi non pagati di tutti i suoi corsi del ' + esc(S.es) + ' diventano da non incassare (grigi): non risultano più da versare, né qui né nel Bilancio. I pagamenti fatti restano e il socio viene segnato non attivo.</p>' +
        '<div class="row" style="align-items:end"><label class="field" style="flex:1 1 160px"><span>Da</span><select class="in" id="sm-mese">' + mesi.map((ym) => '<option value="' + ym + '"' + (ym === def ? ' selected' : '') + '>' + esc(meseNome(ym)) + '</option>').join('') + '</select></label>' +
        '<div style="flex:0 0 auto"><button class="btn" data-act="socio-smesso">Ha smesso</button></div></div></div>';
    }
    if (np) h += '<div><b>Elimina dall’app</b><p class="small muted" style="margin:2px 0 0">Non si può: ha ' + np + (np === 1 ? ' pagamento registrato' : ' pagamenti registrati') + '. Usa «Ha smesso», oppure elimina prima i pagamenti (in Ultimi o toccando le celle in Corsi).</p></div>';
    else if (d.confElimina) h += '<div class="msg err">Eliminare ' + esc(so.nominativo) + ' e i suoi corsi dall’app?</div><div class="azioni" style="margin:0"><button class="btn ghost" data-act="socio-elimina-no">No</button><button class="btn primary" style="background:var(--red);border-color:var(--red)" data-act="socio-elimina-ok">Sì, elimina</button></div>';
    else h += '<div><b>Elimina dall’app</b><p class="small muted" style="margin:2px 0 8px">Per un socio inserito per errore, doppio o che non è mai venuto: sparisce dall’elenco, dai corsi e dalle quote da versare. Non ha pagamenti, quindi la contabilità non cambia.</p><button class="btn danger" data-act="socio-elimina">Elimina il socio</button></div>';
    return h + '</div></details>';
  }
  function socioSmesso() {
    const { sid } = S.dialog;
    const so = socio(sid);
    const da = ($('#sm-mese') && $('#sm-mese').value) || meseCorrente();
    const st = situazione(sid);
    const prima = [{ t: 'soci', r: { ...so } }];
    let n = 0;
    iscrizioniSocio(sid).forEach((i) => {
      const nd = nonDovuti(i), imp = importiNonDovuti(i);
      const nuovi = mesiCorso(corso(i.corso)).filter((ym) => ym >= da && !st.cell.has(i.corso + '|' + ym) && !nd.has(ym));
      if (!nuovi.length) return;
      prima.push({ t: 'iscrizioni', r: { ...i } });
      nuovi.forEach((ym) => nd.add(ym));
      n += nuovi.length;
      scrivi('iscrizioni', { ...i, nonDovuti: testoNonDovuti(nd, imp) });
    });
    scrivi('soci', { ...so, attivo: false });
    S.dialog = null; fatto();
    toast(so.nominativo + ': ' + (n ? n + (n === 1 ? ' mese' : ' mesi') + ' da ' + meseNome(da) + ' in poi da non incassare' : 'nessun mese da cambiare') + ', socio non attivo.', '', { label: 'Annulla', fn: () => { prima.forEach((x) => scrivi(x.t, x.r)); fatto(); toast('Annullato.'); } });
  }
  function eliminaSocio() {
    const { sid } = S.dialog;
    const so = socio(sid);
    if (!so || vivi('pagamenti').some((p) => p.socio === sid)) { S.dialog.confElimina = false; renderDialog(); return; }
    const isc = Object.values(S.dati.iscrizioni).filter((i) => i && i.socio === sid && !i.eliminato);
    isc.forEach((i) => scrivi('iscrizioni', { ...i, eliminato: true }));
    scrivi('soci', { ...so, eliminato: true });
    S.dialog = null;
    if (S.F && S.F.socio === sid) S.F = null;
    fatto();
    toast(so.nominativo + ' eliminato dall’app.', '', { label: 'Annulla', fn: () => { scrivi('soci', { ...S.dati.soci[sid], eliminato: false }); isc.forEach((i) => scrivi('iscrizioni', { ...S.dati.iscrizioni[i.id], eliminato: false })); fatto(); toast('Socio ripristinato.'); } });
  }
  function salvaSocio() {
    const d = S.dialog, v = d.v;
    const so = d.sid ? socio(d.sid) : null;
    let nominativo;
    if (so && !so.cognome) nominativo = String(v.nominativo || '').trim().toUpperCase();
    else {
      if (!v.cognome.trim() || !v.nome.trim()) { d.err = 'Scrivi nome e cognome.'; renderDialog(); return; }
      nominativo = (v.nome.trim() + ' ' + v.cognome.trim()).toUpperCase().replace(/\s+/g, ' ');
    }
    if (!nominativo) { d.err = 'Scrivi il nominativo.'; renderDialog(); return; }
    const dup = vivi('soci').find((x) => norm(x.nominativo) === norm(nominativo) && (!so || x.id !== so.id));
    if (dup && !d.dupOk) { d.err = 'C’è già un socio «' + dup.nominativo + '». Premi di nuovo per crearne comunque un altro.'; d.dupOk = true; renderDialog(); return; }
    const now = adesso();
    const rec = scrivi('soci', {
      ...(so || { id: uid('s'), creato: now, eliminato: false }),
      nominativo, cognome: so && !so.cognome ? null : v.cognome.trim(), nome: so && !so.cognome ? null : v.nome.trim(),
      telefono: v.telefono.trim() || null, certificato: !!v.certificato || !!v.scadenzaCert, scadenzaCert: v.scadenzaCert || null, note: v.note.trim() || null, attivo: so ? !!v.attivo : true
    });
    Object.keys(v.corsi).filter((k) => v.corsi[k]).forEach((cid) => {
      scrivi('iscrizioni', { id: uid('i'), esercizio: S.es, socio: rec.id, corso: cid, quota: null, nonDovuti: null, note: null, eliminato: false });
    });
    // quote personali modificate
    (d.quote ? Object.keys(d.quote) : []).forEach((iid) => {
      const i = S.dati.iscrizioni[iid];
      if (i) scrivi('iscrizioni', { ...i, quota: numIn(d.quote[iid]) });
    });
    const perIncasso = d.perIncasso;
    S.dialog = null;
    if (perIncasso) { scegliSocio(rec.id, null, true); S.view = 'incassa'; if (location.hash !== '#incassa') location.hash = 'incassa'; }
    fatto();
    toast(so ? 'Socio aggiornato.' : 'Creato ' + nominativo + '.');
  }

  function dlgIscrivi() {
    const d = S.dialog;
    if (d.sid) {
      const so = socio(d.sid);
      const gia = new Set(iscrizioniSocio(so.id).map((i) => i.corso));
      const altri = corsiAttivi().filter((c) => !gia.has(c.id));
      return '<h3>Iscrivi ' + esc(so.nominativo) + '</h3><p class="muted" style="margin:0">Scegli il corso del ' + esc(S.es) + '.</p><div class="lista" style="margin:0 -16px">' + (altri.length ? altri.map((c) => '<button class="voce" data-iscrivi-a="' + esc(c.id) + '"><span class="t"><b>' + esc(c.nome) + '</b><small>' + esc(c.titolo || '') + '</small></span><span class="r">€ ' + eur(c.quota) + '</span></button>').join('') : '<div class="empty">È già iscritto a tutti i corsi.</div>') + '</div><div class="azioni"><button class="btn ghost" data-act="chiudi">Chiudi</button></div>';
    }
    // iscrivi un socio al corso aperto
    const c = corso(S.corso);
    const gia = new Set(iscrizioniCorso(c.id).map((i) => i.socio));
    const toks = norm(d.q || '').split(' ').filter(Boolean);
    const lst = toks.length ? vivi('soci').filter((s) => !gia.has(s.id) && toks.every((t) => norm(s.nominativo).includes(t))).slice(0, 10) : [];
    return '<h3>Iscrivi a ' + esc(c.nome) + '</h3><label class="field"><span>Cerca il socio</span><input class="in" id="cerca-iscr" type="search" value="' + esc(d.q || '') + '" autofocus autocomplete="off"></label><div class="lista" style="margin:0 -16px">' + lst.map((s) => '<button class="voce" data-iscrivi-socio="' + esc(s.id) + '"><span class="t"><b>' + esc(s.nominativo) + '</b></span></button>').join('') + '</div>' +
      '<div class="azioni"><button class="btn ghost" data-act="chiudi">Chiudi</button><button class="btn" data-act="nuovo-socio-corso">+ Nuovo socio</button></div>';
  }
  function iscrivi(sid, cid) {
    const old = Object.values(S.dati.iscrizioni).find((i) => i.socio === sid && i.corso === cid && i.esercizio === S.es);
    if (old) scrivi('iscrizioni', { ...old, eliminato: false });
    else scrivi('iscrizioni', { id: uid('i'), esercizio: S.es, socio: sid, corso: cid, quota: null, nonDovuti: null, note: null, eliminato: false });
  }

  function dlgVersamento() {
    const v = versamenti().find((x) => x.id === S.dialog.id);
    if (!v) return '<h3>Incasso non trovato</h3><div class="azioni"><button class="btn" data-act="chiudi">Chiudi</button></div>';
    const tot = r2(v.righe.reduce((x, p) => x + importoPag(p), 0));
    const piu = v.soci.length > 1;
    const ordSoci = new Map(v.soci.map((x, i) => [x.id, i]));
    let h = '<h3>' + esc(v.soci.map((x) => x.nominativo).join(' + ')) + '</h3><div class="muted">' + esc(fmtData(v.data)) + ' · ' + esc(nomeMezzo(v.mezzo)) + ' · € ' + eur(tot) + (piu ? ' · pagamento unico per ' + v.soci.length + ' soci' : '') + '</div>' +
      (v.mezzo === 'allenatore' ? '<div class="msg err">Contanti ancora presso l’allenatore: non sono in cassa.</div>' : '') +
      '<table class="anteprima"><tbody>' + v.righe.slice().sort((a, b) => (ordSoci.get(a.socio) - ordSoci.get(b.socio)) || String(a.corso).localeCompare(String(b.corso)) || String(a.mese).localeCompare(String(b.mese))).map((p) => '<tr><td>' + (piu ? '<b>' + esc((socio(p.socio) || {}).nominativo || p.nominativo) + '</b> · ' : '') + esc(p.voce === 'iscrizione' ? 'Iscrizione ' + p.esercizio : nomeCorso(corso(p.corso)) + ' · ' + meseNome(p.mese)) + '</td><td class="num">€ ' + eur(importoPag(p)) + '</td></tr>').join('') + '</tbody></table>' +
      (v.righe[0].nota ? '<div class="small">' + esc(v.righe[0].nota) + '</div>' : '') +
      '<div class="small muted">' + esc(v.righe[0].dispositivo ? 'Registrato da ' + v.righe[0].dispositivo : '') + (v.righe.some((p) => inCoda('pagamenti', p.id)) ? ' · da inviare al foglio' : '') + '</div>';
    if (S.dialog.conferma) h += '<div class="msg err">Eliminare questo incasso? Se è già nel Bilancio, l’operazione in contabilità resta e va tolta a mano.</div><div class="azioni"><button class="btn ghost" data-act="chiudi">No</button><button class="btn primary" style="background:var(--red);border-color:var(--red)" data-act="elimina-vers-ok">Sì, elimina</button></div>';
    else if (S.dialog.unisci) {
      // incassi dello stesso giorno e con lo stesso mezzo, da unire in un pagamento unico
      const altri = versamenti().filter((x) => x.id !== v.id && x.data === v.data && x.mezzo === v.mezzo);
      h += '<div class="msg ok">Scegli l’incasso pagato con lo stesso movimento di denaro (stesso giorno, ' + esc(nomeMezzo(v.mezzo)) + ').</div>' +
        (altri.length ? '<div class="lista" style="margin:0 -16px">' + altri.map((x) => '<button class="voce" data-unisci-con="' + esc(x.id) + '"><span class="t"><b>' + esc(x.soci.map((y) => y.nominativo).join(' + ')) + '</b><small>' + esc(descVersamento(x)) + '</small></span><span class="r"><b>€ ' + eur(x.righe.reduce((y, p) => y + importoPag(p), 0)) + '</b></span></button>').join('') + '</div>' : '<div class="empty small">Nessun altro incasso del ' + esc(fmtData(v.data)) + ' con ' + esc(nomeMezzo(v.mezzo)) + '.</div>') +
        '<div class="azioni"><button class="btn ghost" data-act="vers-unisci-no">Indietro</button></div>';
    } else {
      h += '<div class="small muted" style="margin-top:4px">Un incasso è un unico movimento di denaro: nel Bilancio diventa una sola scrittura, anche con più soci. Se è già registrato nel Bilancio, unire o separare qui non cambia la scrittura: va corretta a mano.</div>' +
        '<div class="azioni" style="flex-wrap:wrap"><button class="btn" data-act="vers-aggiungi">+ Aggiungi un socio a questo pagamento</button><button class="btn" data-act="vers-unisci">Unisci con un altro incasso</button>' + (piu ? '<button class="btn" data-act="vers-separa">Separa i soci</button>' : '') + '</div>' +
        '<div class="azioni"><button class="btn danger" data-act="elimina-vers">Elimina</button>' + (v.mezzo === 'allenatore' ? '<button class="btn primary" data-consegna="' + esc(v.id) + '">Consegnato in cassa</button>' : '') + '<button class="btn" data-act="chiudi">Chiudi</button></div>';
    }
    return h;
  }
  // sposta i pagamenti di un incasso in un altro (pagamento unico) o li divide per socio
  function riassegnaVersamento(righe, ver) {
    const prima = righe.map((p) => ({ ...p }));
    righe.forEach((p) => scrivi('pagamenti', { ...p, versamento: ver }));
    return () => { prima.forEach((p) => scrivi('pagamenti', { ...S.dati.pagamenti[p.id], versamento: p.versamento })); fatto(); toast('Annullato.'); };
  }

  function dlgCorso() {
    const d = S.dialog;
    const c = d.cid ? corso(d.cid) : null;
    const v = d.v || (d.v = c ? { nome: c.nome, titolo: c.titolo || '', quota: String(c.quota).replace('.', ','), mesi: String(c.mesi || '').length || 11, attivo: c.attivo !== false } : { nome: '', titolo: '', quota: '25', mesi: 11, attivo: true });
    return '<h3>' + (c ? esc(c.nome) : 'Nuovo corso') + '</h3>' +
      '<div class="row"><label class="field"><span>Nome breve</span><input class="in" data-v="nome" value="' + esc(v.nome) + '"' + (c ? '' : ' autofocus') + '></label><label class="field"><span>Quota mensile €</span><input class="in num" inputmode="decimal" data-v="quota" value="' + esc(v.quota) + '"></label></div>' +
      (c ? '<p class="small muted" style="margin:-6px 0 0">Il nome breve è quello che il Bilancio usa per riconoscere il corso: cambialo solo se serve.</p>' : '') +
      '<label class="field"><span>Descrizione</span><input class="in" data-v="titolo" value="' + esc(v.titolo) + '" placeholder="per esempio: Kung fu adulti Alessandria"></label>' +
      '<label class="field"><span>Mesi di corso (da settembre)</span><select class="in" data-v="mesi">' + [9, 10, 11, 12].map((n) => '<option value="' + n + '"' + (Number(v.mesi) === n ? ' selected' : '') + '>' + n + ' mesi, fino a ' + MESI[(8 + n - 1) % 12] + '</option>').join('') + '</select></label>' +
      (c ? '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-v="attivo"' + (v.attivo ? ' checked' : '') + '> Corso attivo</label>' : '') +
      (d.err ? '<div class="msg err">' + esc(d.err) + '</div>' : '') +
      '<div class="azioni"><button class="btn ghost" data-act="chiudi">Annulla</button><button class="btn primary" data-act="salva-corso">Salva</button></div>';
  }
  function salvaCorso() {
    const d = S.dialog, v = d.v;
    const c = d.cid ? corso(d.cid) : null;
    const nome = String(v.nome || '').trim();
    if (!nome) { d.err = 'Scrivi il nome del corso.'; renderDialog(); return; }
    if (vivi('corsi').some((x) => norm(x.nome) === norm(nome) && (!c || x.id !== c.id))) { d.err = 'Esiste già un corso con questo nome.'; renderDialog(); return; }
    const q = numIn(v.quota);
    if (!(q >= 0)) { d.err = 'Quota non valida.'; renderDialog(); return; }
    const lettere = mesiEs(S.es).slice(0, Number(v.mesi) || 11).map((ym) => INIZIALI[Number(ym.slice(5, 7)) - 1]).join('');
    scrivi('corsi', { ...(c || { id: uid('c'), ordine: corsi().length + 1, eliminato: false }), nome, titolo: String(v.titolo || '').trim() || null, quota: q, mesi: lettere, attivo: c ? !!v.attivo : true });
    S.dialog = null;
    fatto();
  }

  // ------------------------------------------------------------------ collegare un altro dispositivo con un link (o il QR)
  const b64u = (t) => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const ub64 = (t) => decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/'))));
  function linkCollega() { return location.origin + location.pathname + '#collega=' + b64u(JSON.stringify({ u: S.conf.url, k: S.conf.chiave })); }
  let qrLib = null;
  function caricaQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (qrLib) return qrLib;
    qrLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'qrcode.js'; sc.onload = () => res(window.qrcode); sc.onerror = () => { qrLib = null; rej(new Error('QR non disponibile')); }; document.head.appendChild(sc); });
    return qrLib;
  }
  function dlgCollega() {
    const link = linkCollega();
    if (!S.dialog.svg) caricaQR().then((qr) => { const q = qr(0, 'M'); q.addData(link); q.make(); if (S.dialog && S.dialog.tipo === 'collega') { S.dialog.svg = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }); renderDialog(); } }).catch(() => {});
    return '<h3>Collega un altro dispositivo</h3><p class="muted" style="margin:0">Inquadra il codice con la fotocamera del cellulare, oppure mandati il link (per esempio su WhatsApp) e aprilo dal telefono: l’app si collega da sola al Foglio Google.</p>' +
      '<div style="max-width:260px;margin:0 auto;background:#fff;padding:8px;border-radius:8px;width:100%">' + (S.dialog.svg || '<div class="empty">Preparo il codice…</div>') + '</div>' +
      '<div class="msg warn small">Il link contiene la chiave di accesso: mandalo solo a te stesso o a chi deve registrare i pagamenti.</div>' +
      '<div class="azioni"><button class="btn ghost" data-act="chiudi">Chiudi</button>' + (navigator.share ? '<button class="btn" data-act="condividi-link">Condividi</button>' : '') + '<button class="btn primary" data-act="copia-link">Copia il link</button></div>';
  }
  function collegaDaLink() {
    const m = /^#collega=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return false;
    try {
      const x = JSON.parse(ub64(m[1]));
      if (x && x.u && x.k) { S.conf.url = x.u; S.conf.chiave = x.k; S.sync.errore = null; salva(); }
    } catch (e) { console.warn(e); }
    history.replaceState(null, '', location.pathname + '#incassa');
    S.view = 'incassa';
    return true;
  }

  // ------------------------------------------------------------------ importazione dal registro Excel
  let excelJs = null;
  function caricaExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelJs) return excelJs;
    excelJs = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = () => res(window.ExcelJS);
      s.onerror = () => { excelJs = null; rej(new Error('Non riesco a caricare il lettore dei file Excel: serve la connessione.')); };
      document.head.appendChild(s);
    });
    return excelJs;
  }
  const QUOTE_NOTE = { 'j+t': 50, 'kung fu': 50, 'tai chi al': 50 };
  async function leggiExcel(file) {
    const X = await caricaExcelJS();
    const wb = new X.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const C = window.Core;
    const es = S.es;
    const s = { es, inizio: es.slice(0, 4) + '-09-01', fine: es.slice(5, 9) + '-08-31' };
    const L = C.leggiRegistro(wb, s, oggi());
    if (!L.fogli.length) throw new Error('Nel file non trovo fogli con le colonne «Nominativo», «I» e i mesi.');
    const quote = {};
    L.fogli.forEach((f) => {
      const esistente = vivi('corsi').find((c) => norm(c.nome) === norm(f.nome));
      quote[f.nome] = esistente ? esistente.quota : QUOTE_NOTE[norm(f.nome)] || 25;
    });
    S.imp = { nome: file.name, L, quote, es };
    apri({ tipo: 'importa' });
  }
  function anteprimaImport() {
    const { L } = S.imp;
    const C = window.Core;
    const persone = new Set(L.righe.map((r) => C.normNome(r.nomeReg)));
    const ok = L.pagamenti.filter((p) => !p.problemi.length || (p.problemi.length === 1 && p.problemi[0] === 'colore' && false));
    const scartati = L.pagamenti.filter((p) => p.problemi.length).concat(L.saltati.map((p) => ({ ...p, problemi: ['rosso'] })));
    const grigi = L.righe.reduce((x, r) => x + r.mesi.length + (r.assoc ? 1 : 0), 0);
    return { persone: persone.size, ok, scartati, grigi };
  }
  function dlgImporta() {
    const { L, nome, quote, es } = S.imp;
    const a = anteprimaImport();
    const MOT = { senzaData: 'senza data', illeggibile: 'contenuto non leggibile', fuori: 'fuori dall’anno ' + es, futura: 'data futura', colore: 'colore non in legenda', senzaNome: 'senza nominativo', rosso: 'cella rossa' };
    const giaDati = vivi('pagamenti').length > 0;
    return '<h3>Importa «' + esc(nome) + '»</h3><p class="muted" style="margin:0">Anno ' + esc(es) + ': ' + L.fogli.length + ' corsi, ' + a.persone + ' soci, ' + a.ok.length + ' pagamenti, ' + a.grigi + ' celle grigie.</p>' +
      '<table class="anteprima"><thead><tr><th>Corso</th><th>Mesi</th><th>Quota €</th></tr></thead><tbody>' + L.fogli.map((f) => '<tr><td><b>' + esc(f.nome) + '</b><div class="small muted">' + esc(f.titolo) + '</div></td><td>' + esc(f.mesi) + '</td><td><input class="in num" inputmode="decimal" data-imp-quota="' + esc(f.nome) + '" value="' + esc(String(quote[f.nome]).replace('.', ',')) + '"></td></tr>').join('') + '</tbody></table>' +
      (a.scartati.length ? '<details><summary class="small">' + a.scartati.length + ' celle non importate</summary><ul class="small">' + a.scartati.map((p) => '<li>' + esc(p.nomeReg || '—') + ' · ' + esc(p.foglio) + ' ' + esc(p.cella) + ' «' + esc(p.testo) + '»: ' + esc(p.problemi.map((x) => MOT[x] || x).join(', ')) + '</li>').join('') + '</ul></details>' : '') +
      (giaDati ? '<div class="msg warn">Nell’archivio ci sono già dei pagamenti: quelli importati dall’Excel si aggiornano, quelli inseriti con l’app restano. Se un pagamento è stato inserito sia nell’Excel sia nell’app, comparirà due volte.</div>' : '') +
      '<div class="azioni"><button class="btn ghost" data-act="chiudi">Annulla</button><button class="btn primary" data-act="importa-ok">Importa</button></div>';
  }
  function importa() {
    const { L, quote, es } = S.imp;
    const C = window.Core;
    const a = anteprimaImport();
    const ordine = new Map();
    // corsi
    const idCorso = {};
    L.fogli.forEach((f, i) => {
      const old = vivi('corsi').find((c) => norm(c.nome) === norm(f.nome));
      const rec = scrivi('corsi', { ...(old || { id: 'c:' + C.normNome(f.nome), eliminato: false, attivo: true }), nome: f.nome, titolo: (old && old.titolo) || f.titolo || null, quota: num(quote[f.nome]), mesi: f.mesi, ordine: old ? old.ordine : i + 1 });
      idCorso[f.nome] = rec.id;
      ordine.set(f.nome, i);
    });
    // soci (una persona per nominativo, anche se compare in più corsi)
    const idSocio = {};
    const certi = {};
    L.righe.forEach((r) => {
      const k = C.normNome(r.nomeReg);
      if (!certi[k]) certi[k] = { cert: false, scad: null, nome: r.nomeReg };
      if (r.cert) certi[k].cert = true;
      if (r.scad && (!certi[k].scad || r.scad > certi[k].scad)) certi[k].scad = r.scad;
    });
    Object.keys(certi).forEach((k) => {
      const old = vivi('soci').find((s) => C.normNome(s.nominativo) === k);
      const x = certi[k];
      const rec = old ? scrivi('soci', { ...old, certificato: old.certificato || x.cert, scadenzaCert: old.scadenzaCert || x.scad }) : scrivi('soci', { id: 's:' + k, nominativo: String(x.nome).trim().replace(/\s+/g, ' ').toUpperCase(), cognome: null, nome: null, telefono: null, certificato: x.cert || !!x.scad, scadenzaCert: x.scad, note: null, attivo: true, creato: adesso(), eliminato: false });
      idSocio[k] = rec.id;
    });
    // iscrizioni con i mesi grigi
    L.righe.forEach((r) => {
      const sid = idSocio[C.normNome(r.nomeReg)], cid = idCorso[r.foglio];
      const old = Object.values(S.dati.iscrizioni).find((i) => i.socio === sid && i.corso === cid && i.esercizio === es);
      const nd = new Set((r.assoc ? ['I'] : []).concat(r.mesi));
      const imp = new Map(Object.entries(r.importiNd || {}));
      scrivi('iscrizioni', { ...(old || { id: 'i:' + C.normNome(r.nomeReg) + '|' + r.foglio + '|' + es, quota: null, note: null }), esercizio: es, socio: sid, corso: cid, nonDovuti: testoNonDovuti(nd, imp), eliminato: false });
    });
    // pagamenti: id fissi, così importare di nuovo aggiorna invece di duplicare
    a.ok.forEach((p) => {
      const k = C.normNome(p.nomeReg);
      const sid = idSocio[k];
      if (!sid) return;
      const voce = p.voce === 'assoc' ? 'iscrizione' : 'mese';
      scrivi('pagamenti', {
        id: 'x:' + k + '|' + (voce === 'iscrizione' ? 'I' : p.mese) + '|' + p.foglio + '|' + es,
        versamento: 'x:' + k + '|' + p.data + '|' + (p.mezzo || ''),
        esercizio: es, data: p.data, socio: sid, nominativo: socio(sid).nominativo, corso: idCorso[p.foglio], voce, mese: voce === 'mese' ? p.mese : null,
        importo: p.importo != null ? p.importo : null, mezzo: p.mezzo || 'contanti', nota: null, dispositivo: 'Registro Excel', creato: adesso(), eliminato: false
      });
    });
    S.imp = null;
    S.dialog = null;
    fatto();
    toast('Importati ' + a.ok.length + ' pagamenti e ' + Object.keys(idSocio).length + ' soci.');
  }

  function esporta() {
    const tab = {};
    TABELLE.forEach((t) => { tab[t] = Object.values(S.dati[t]); });
    const blob = new Blob([JSON.stringify({ tipo: 'registro-pagamenti', versione: 1, esportato: adesso(), dispositivo: S.conf.dispositivo, tabelle: tab }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'registro-pagamenti-' + oggi() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------ eventi
  function vai(v) { S.view = v; S.dialog = null; render(); window.scrollTo(0, 0); }
  function init() {
    carica();
    const daLink = collegaDaLink();
    const h = location.hash.replace('#', '');
    if (VISTE.some((x) => x[0] === h)) S.view = h;
    window.addEventListener('hashchange', () => { const v = location.hash.replace('#', ''); if (VISTE.some((x) => x[0] === v)) vai(v); });
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.matches('[data-chiudi]')) { chiudi(); return; }
      const el = t.closest('button, [data-cella]');
      if (!el) return;
      const ds = el.dataset;
      const act = ds.act;
      if (act === 'sync') { if (collegato()) sincronizza(); else vai('altro'); return; }
      if (act === 'chiudi') { chiudi(); return; }
      if (act === 'nuovo-socio') { apri({ tipo: 'socio', perIncasso: S.view === 'incassa' }); return; }
      if (act === 'cambia-socio') { const u = S.F && S.F.unisci; S.F = nuovoForm(); if (u) S.F.unisci = u; render(); setTimeout(() => { const n = $('#cerca-socio'); if (n) n.focus(); }, 0); return; }
      if (act === 'registra') { registraPagamento(false); return; }
      if (act === 'registra-altro') { registraPagamento(true); return; }
      if (act === 'unisci-fine') { S.F = nuovoForm(); render(); toast('Pagamento unico chiuso.'); return; }
      if (act === 'vers-aggiungi') {
        const v = versamenti().find((x) => x.id === S.dialog.id);
        if (!v) return;
        S.dialog = null;
        S.F = nuovoForm();
        S.F.unisci = { ver: v.id, data: v.data, mezzo: v.mezzo, nota: v.righe[0].nota || null, soci: v.soci.map((x) => ({ nome: x.nominativo, tot: r2(v.righe.filter((p) => p.socio === x.id).reduce((y, p) => y + importoPag(p), 0)) })) };
        location.hash = 'incassa'; vai('incassa'); setTimeout(() => { const n = $('#cerca-socio'); if (n) n.focus(); }, 0);
        return;
      }
      if (act === 'vers-unisci') { S.dialog.unisci = true; renderDialog(); return; }
      if (act === 'vers-unisci-no') { S.dialog.unisci = false; renderDialog(); return; }
      if (act === 'vers-separa') {
        const v = versamenti().find((x) => x.id === S.dialog.id);
        if (!v || v.soci.length < 2) return;
        const prima = v.righe.map((p) => ({ ...p }));
        v.soci.slice(1).forEach((x) => { const ver = uid('v'); v.righe.filter((p) => p.socio === x.id).forEach((p) => scrivi('pagamenti', { ...p, versamento: ver })); });
        S.dialog = null; fatto();
        toast('Incasso separato: ' + v.soci.length + ' pagamenti distinti.', '', { label: 'Annulla', fn: () => { prima.forEach((p) => scrivi('pagamenti', { ...S.dati.pagamenti[p.id], versamento: p.versamento })); fatto(); toast('Annullato.'); } });
        return;
      }
      if (act === 'iscrivi') { apri({ tipo: 'iscrivi', sid: ds.socio }); return; }
      if (act === 'iscrivi-corso') { apri({ tipo: 'iscrivi', q: '' }); return; }
      if (act === 'nuovo-socio-corso') { const cid = S.corso; apri({ tipo: 'socio', v: { cognome: '', nome: '', telefono: '', certificato: false, scadenzaCert: '', note: '', attivo: true, corsi: { [cid]: true } } }); return; }
      if (act === 'salva-socio') { salvaSocio(); return; }
      if (act === 'socio-smesso') { socioSmesso(); return; }
      if (act === 'socio-elimina') { S.dialog.confElimina = true; S.dialog.togliAperto = true; renderDialog(); return; }
      if (act === 'socio-elimina-no') { S.dialog.confElimina = false; renderDialog(); return; }
      if (act === 'socio-elimina-ok') { eliminaSocio(); return; }
      if (act === 'socio-incassa') { const sid = S.dialog.sid; S.dialog = null; scegliSocio(sid); location.hash = 'incassa'; vai('incassa'); return; }
      if (act === 'incassa-cella') { const { sid, cid, mese } = S.dialog; S.dialog = null; scegliSocio(sid, mese === 'I' ? {} : { [cid + '|' + mese]: true }); S.F.iscr = mese === 'I'; location.hash = 'incassa'; vai('incassa'); return; }
      if (act === 'elimina-vers') { S.dialog.conferma = true; renderDialog(); return; }
      if (act === 'elimina-vers-ok') { const v = versamenti().find((x) => x.id === S.dialog.id); if (v) v.righe.forEach((p) => scrivi('pagamenti', { ...p, eliminato: true })); S.dialog = null; fatto(); toast('Incasso eliminato.'); return; }
      if (act === 'nuovo-corso') { apri({ tipo: 'corso' }); return; }
      if (act === 'salva-corso') { salvaCorso(); return; }
      if (act === 'collega') {
        S.conf.url = ($('#c-url').value || '').trim();
        S.conf.chiave = ($('#c-chiave').value || '').trim();
        S.sync.errore = null; salva();
        if (!collegato()) { render(); toast('Inserisci URL e chiave.', 'err'); return; }
        sincronizza().then(() => { if (!S.sync.errore) toast('Collegato al Foglio Google.'); });
        return;
      }
      if (act === 'salva-conf') { S.conf.dispositivo = ($('#c-disp').value || '').trim() || S.conf.dispositivo; const q = numIn($('#c-iscr').value); if (q != null) S.conf.quotaIscrizione = q; salva(); render(); toast('Salvato.'); return; }
      if (act === 'esporta') { esporta(); return; }
      if (act === 'inv-numeri') { apri({ tipo: 'numeri', v: {} }); return; }
      if (act === 'numeri-salva') { salvaNumeri(); return; }
      if (act === 'inv-nuovo') { S.conf.invii = invii().concat([{ id: uid('w'), nome: 'Destinatario', tel: '', corsi: [], ultimo: null }]); salva(); render(); return; }
      if (act === 'inv-salta') { const lun = lunediDi(oggi()); invii().forEach((x) => { if ((x.ultimo || '') < lun) x.ultimo = lun; }); salva(); render(); toast('Promemoria nascosto fino a lunedì prossimo.'); return; }
      if (ds.invInvia) { inviaQuote(ds.invInvia); return; }
      if (ds.invAnteprima) { anteprimaQuote(ds.invAnteprima); return; }
      if (ds.invCondividi) {
        const inv = invio(ds.invCondividi), d = S.dialog;
        if (!inv || !d) return;
        navigator.share({ files: d.imm.map((x) => x.file), text: testoInvio(inv, d.imm) })
          .then(() => { chiudi(); segnaInviato(inv); toast('Quote di «' + inv.nome + '» inviate.'); })
          .catch((e) => { if (!e || e.name !== 'AbortError') toast('Condivisione non riuscita: scarica le immagini e allegale in WhatsApp.', 'err'); });
        return;
      }
      if (ds.invFatto) { const inv = invio(ds.invFatto); if (inv) { chiudi(); segnaInviato(inv); toast('Segnato come inviato per questa settimana.'); } return; }
      if (ds.invScarica !== undefined && S.dialog && S.dialog.imm) {
        const x = S.dialog.imm[Number(ds.invScarica)];
        const a = document.createElement('a'); a.href = S.dialog.url[Number(ds.invScarica)]; a.download = x.nome; document.body.appendChild(a); a.click(); a.remove();
        return;
      }
      if (ds.invCopia !== undefined && S.dialog && S.dialog.imm) {
        const x = S.dialog.imm[Number(ds.invCopia)];
        blobDa(x.cv, 'image/png').then((b) => navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]))
          .then(() => toast('Tabella copiata: nella chat premi Ctrl+V e poi Invio.'), () => toast('Copia non riuscita: usa «Scarica».', 'err'));
        return;
      }
      if (ds.invDel) { const prima = invii().slice(); S.conf.invii = invii().filter((x) => x.id !== ds.invDel); salva(); render(); toast('Destinatario eliminato.', '', { label: 'Annulla', fn: () => { S.conf.invii = prima; salva(); render(); } }); return; }
      if (ds.invCorso) { const [iid, cid] = ds.invCorso.split('|'); const inv = invio(iid); if (inv) { const set = new Set(inv.corsi || []); if (set.has(cid)) set.delete(cid); else set.add(cid); inv.corsi = corsi().map((c) => c.id).filter((k) => set.has(k)); salva(); render(); } return; }
      if (act === 'link-collega') { apri({ tipo: 'collega' }); return; }
      if (act === 'copia-link') { const l = linkCollega(); (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(() => toast('Link copiato.'), () => { window.prompt('Copia il link:', l); }); return; }
      if (act === 'condividi-link') { navigator.share({ title: 'Registro pagamenti', text: 'Collega l’app Registro pagamenti', url: linkCollega() }).catch(() => {}); return; }
      if (act === 'ricarica') { sincronizza(); return; }
      if (act === 'importa-ok') { importa(); return; }
      if (ds.socio && el.closest('.sugg')) { scegliSocio(ds.socio, null, true); render(); return; }
      if (ds.unisciCon) {
        const v = versamenti().find((x) => x.id === S.dialog.id), w = versamenti().find((x) => x.id === ds.unisciCon);
        if (!v || !w) return;
        const annulla = riassegnaVersamento(w.righe, v.id);
        S.dialog = null; fatto();
        toast('Pagamento unico: ' + v.soci.concat(w.soci.filter((y) => !v.soci.some((z) => z.id === y.id))).map((y) => y.nominativo).join(' + ') + '.', '', { label: 'Annulla', fn: annulla });
        return;
      }
      if (ds.mese !== undefined && S.F) { S.F.sel[ds.mese] = !S.F.sel[ds.mese]; render(); return; }
      if (ds.iscr !== undefined && S.F) { S.F.iscr = !S.F.iscr; render(); return; }
      if (ds.mezzo) { S.F.mezzo = ds.mezzo; render(); return; }
      if (ds.corso && el.closest('.corsi-sel')) { S.corso = ds.corso; salva(); render(); return; }
      if (ds.cella) { const [sid, cid, mese] = ds.cella.split('|'); apri({ tipo: 'cella', sid, cid, mese }); return; }
      if (ds.socioEd) { apri({ tipo: 'socio', sid: ds.socioEd }); return; }
      if (ds.vers) { apri({ tipo: 'versamento', id: ds.vers }); return; }
      if (ds.corsoEd) { apri({ tipo: 'corso', cid: ds.corsoEd }); return; }
      if (ds.corsoSc) { const v = S.dialog.v; if (S.dialog.sid) { iscrivi(S.dialog.sid, ds.corsoSc); salva(); renderDialog(); pianificaSync(800); } else { v.corsi[ds.corsoSc] = !v.corsi[ds.corsoSc]; renderDialog(); } return; }
      if (ds.togliIsc) { const i = S.dati.iscrizioni[ds.togliIsc]; if (i) { scrivi('iscrizioni', { ...i, eliminato: true }); salva(); renderDialog(); pianificaSync(800); } return; }
      if (ds.iscriviA) { iscrivi(S.dialog.sid, ds.iscriviA); const sid = S.dialog.sid; S.dialog = null; if (S.F && S.F.socio === sid) scegliSocio(sid); fatto(); return; }
      if (ds.iscriviSocio) { iscrivi(ds.iscriviSocio, S.corso); S.dialog = null; fatto(); return; }
      if (ds.consegna) {
        const quando = fmtData(oggi());
        const lista = Object.values(S.dati.pagamenti).filter((p) => !p.eliminato && p.mezzo === 'allenatore' && (p.versamento === ds.consegna || p.id === ds.consegna));
        lista.forEach((p) => scrivi('pagamenti', { ...p, mezzo: 'contanti', nota: ((p.nota ? p.nota + ' · ' : '') + 'consegnato in cassa il ' + quando) }));
        S.dialog = null; fatto(); toast(lista.length ? 'Segnato: contanti consegnati in cassa il ' + quando + '.' : 'Niente da segnare.');
        return;
      }
      if (ds.eliminaPag) { const p = S.dati.pagamenti[ds.eliminaPag]; if (p) { scrivi('pagamenti', { ...p, eliminato: true }); S.dialog = null; fatto(); toast('Pagamento eliminato.', '', { label: 'Annulla', fn: () => { scrivi('pagamenti', { ...S.dati.pagamenti[p.id], eliminato: false }); fatto(); } }); } return; }
      if (act === 'grigio-chiedi') { S.dialog.grigio = true; renderDialog(); return; }
      if (act === 'grigio-annulla') { S.dialog.grigio = false; renderDialog(); return; }
      if (act === 'grigio-ok' || ds.grigio !== undefined) {
        const { sid, cid, mese } = S.dialog;
        const i = iscrizioniSocio(sid).find((x) => x.corso === cid);
        const togli = ds.grigio === '0';
        let v = null;
        if (!togli) {
          const tx = ($('#nd-imp') && $('#nd-imp').value) || '';
          v = numIn(tx);
          if (tx.trim() && (v == null || v < 0)) { toast('Importo non valido.', 'err'); return; }
        }
        if (i) {
          const nd = nonDovuti(i), imp = importiNonDovuti(i);
          if (togli) { nd.delete(mese); imp.delete(mese); } else { nd.add(mese); if (v != null && v > 0) imp.set(mese, Math.round(v * 100) / 100); else imp.delete(mese); }
          scrivi('iscrizioni', { ...i, nonDovuti: testoNonDovuti(nd, imp) });
        }
        S.dialog = null; fatto(); return;
      }
    });
    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.id === 'cerca-socio') { S.F.q = t.value; render(); return; }
      if (t.id === 'cerca-soci') { S.qSoci = t.value; render(); return; }
      if (t.id === 'soci-filtro') { S.fSoci = t.value; render(); return; }
      if (t.id === 'cerca-ultimi') { S.qUltimi = t.value; render(); return; }
      if (t.id === 'cerca-iscr') { S.dialog.q = t.value; renderDialog(); const n = $('#cerca-iscr'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } return; }
      if (t.dataset.v !== undefined && S.dialog && S.dialog.v) { S.dialog.v[t.dataset.v] = t.type === 'checkbox' ? t.checked : t.value; return; }
      if (t.dataset.numero && S.dialog && S.dialog.tipo === 'numeri') { S.dialog.v[t.dataset.numero] = t.value; return; }
      if (t.dataset.quotaIsc !== undefined && S.dialog) { (S.dialog.quote = S.dialog.quote || {})[t.dataset.quotaIsc] = t.value; return; }
      if (t.dataset.impQuota !== undefined && S.imp) { S.imp.quote[t.dataset.impQuota] = t.value; return; }
      if (t.id === 'f-nota') { S.F.nota = t.value; return; }
    });
    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.id === 'es') { S.es = t.value; S.F = null; salva(); render(); return; }
      if (t.id === 'f-data') { S.F.data = t.value; return; }
      if (t.dataset.quota !== undefined) { const q = numIn(t.value); if (q != null) S.F.quote[t.dataset.quota] = q; render(); return; }
      if (t.dataset.impIscr !== undefined) { const q = numIn(t.value); if (q != null) S.F.impIscr = q; render(); return; }
      if (t.dataset.ricorda !== undefined) { S.F.ricorda[t.dataset.ricorda] = t.checked; return; }
      if (t.dataset.v !== undefined && S.dialog && S.dialog.v) { S.dialog.v[t.dataset.v] = t.type === 'checkbox' ? t.checked : t.value; return; }
      if (t.dataset.inv) { const [iid, k] = t.dataset.inv.split('|'); const inv = invio(iid); if (inv) { inv[k] = t.value.trim() || (k === 'nome' ? 'Destinatario' : ''); salva(); render(); } return; }
      if (t.id === 'imp-xlsx' && t.files && t.files[0]) { const f = t.files[0]; t.value = ''; leggiExcel(f).catch((e) => toast(e.message || 'Il file non si legge.', 'err')); }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && S.dialog) { chiudi(); return; }
      if (ev.key === 'Enter' && ev.target.id === 'cerca-socio') { const b = $('.sugg button[data-socio]'); if (b) { ev.preventDefault(); scegliSocio(b.dataset.socio); render(); } }
    });
    window.addEventListener('online', () => sincronizza());
    window.addEventListener('offline', () => { S.sync.stato = 'offline'; renderSync(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizza(); });
    render();
    sincronizza().then(() => { if (daLink) toast(S.sync.errore ? S.sync.errore : 'Dispositivo collegato al Foglio Google.', S.sync.errore ? 'err' : ''); });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) toast('È disponibile una nuova versione dell’app.', '', { label: 'Aggiorna', fn: () => { w.postMessage('aggiorna'); } }, 30000);
          });
        });
      }).catch((e) => console.warn(e));
      // ricarica solo quando una versione nuova prende il posto di quella in uso (non alla prima installazione)
      const avevaController = !!navigator.serviceWorker.controller;
      let ricaricata = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (avevaController && !ricaricata) { ricaricata = true; location.reload(); } });
    }
  }
  window.RegistroApp = { S, scrivi, sincronizza, render, importoPag, situazione };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
