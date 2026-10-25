/* Bilancio ASD — logica contabile (senza interfaccia).
   Usato dalla pagina e dai test in Node. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- utilità
  const r2 = (x) => Math.round((Number(x) || 0) * 100 + (x >= 0 ? 1e-7 : -1e-7)) / 100;
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  function fmt(v, opts) {
    // 1234.5 -> "1.234,50" ; opts.blankZero -> "" per zero
    const o = opts || {};
    if (v === null || v === undefined || v === '') return '';
    let x = r2(v);
    if (o.blankZero && Math.abs(x) < 0.005) return '';
    const neg = x < 0;
    x = Math.abs(x);
    const [i, d] = x.toFixed(2).split('.');
    const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + g + ',' + d;
  }
  function parseImporto(s) {
    if (typeof s === 'number') return s;
    let t = String(s || '').trim().replace(/[€\s]/g, '');
    if (!t) return null;
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    const v = Number(t);
    return isNaN(v) ? null : r2(v);
  }
  function fmtData(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d + '/' + m + '/' + y;
  }
  function oggiISO() {
    const t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  function addMonths(ym, k) {
    let [y, m] = ym.split('-').map(Number);
    m += k;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return y + '-' + String(m).padStart(2, '0');
  }
  const ymLabel = (ym) => ym.slice(5, 7) + '/' + ym.slice(2, 4); // 2026-10 -> 10/26
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const meseNome = (ym) => MESI[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);

  // ---------------------------------------------------------------- schema di bilancio
  // Rendiconto Economico: sezioni e gruppi come nel foglio originale
  const RE = {
    costi: [
      { id: 'CI', label: 'COSTI ISTITUZIONALI', gruppi: [
        { id: 'tess', label: 'Tesseramento (affiliazioni e tessere)', single: true },
        { id: 'sede', label: 'Costi sede e impianti' },
        { id: 'gen', label: 'Costi generali' },
        { id: 'corsi', label: 'Corsi ed attività ricreativa' },
        { id: 'ofin', label: 'Oneri finanziari' }] },
      { id: 'CC', label: 'COSTI COMMERCIALI', gruppi: [
        { id: 'trib', label: 'Oneri tributari' },
        { id: 'manc', label: 'Manifestazioni e attività commerciali' }] }
    ],
    ricavi: [
      { id: 'RI', label: 'RICAVI ISTITUZIONALI', gruppi: [
        { id: 'quote', label: 'Quote sociali', single: true },
        { id: 'cpub', label: 'Contributi pubblici' },
        { id: 'cpriv', label: 'Contributi privati' },
        { id: 'att', label: 'Attività sportiva e ricreativa' },
        { id: 'pfin', label: 'Proventi finanziari' }] },
      { id: 'RC', label: 'RICAVI COMMERCIALI', gruppi: [
        { id: 'rpub', label: 'Ricavi pubblicitari' },
        { id: 'manr', label: 'Manifestazioni commerciali' },
        { id: 'serv', label: 'Prestazioni di servizi a terzi' }] }
    ]
  };
  const SP = {
    attivo: [
      { id: 'disp', label: 'DISPONIBILITÀ FINANZIARIE', evid: true },
      { id: 'cred', label: 'CREDITI' },
      { id: 'immo', label: 'IMMOBILIZZAZIONI' }],
    passivo: [
      { id: 'pfinz', label: 'PASSIVITÀ FINANZIARIE' },
      { id: 'deb', label: 'DEBITI' },
      { id: 'famm', label: 'FONDI AMMORTAMENTO' },
      { id: 'facc', label: 'FONDI ACCANTONAMENTO' }]
  };
  const TIPI = { C: 'Costo', R: 'Ricavo', A: 'Attività', P: 'Passività', N: 'Patrimonio netto' };

  function gruppiPerTipo(t) {
    if (t === 'C') return RE.costi.flatMap((s) => s.gruppi.map((g) => ({ ...g, sez: s.label })));
    if (t === 'R') return RE.ricavi.flatMap((s) => s.gruppi.map((g) => ({ ...g, sez: s.label })));
    if (t === 'A') return SP.attivo.map((g) => ({ ...g, sez: 'ATTIVITÀ' }));
    if (t === 'P') return SP.passivo.map((g) => ({ ...g, sez: 'PASSIVITÀ' }));
    return [];
  }
  function gruppoLabel(id) {
    for (const t of ['C', 'R', 'A', 'P']) {
      const g = gruppiPerTipo(t).find((x) => x.id === id);
      if (g) return g.label;
    }
    return '';
  }

  // Piano dei conti predefinito (nomi identici al Libro Giornale originale)
  const C = (n, g, rpc, l) => ({ n, t: 'C', g, rpc: rpc || '', ...(l ? { l } : {}) });
  const R = (n, g, rpc, l) => ({ n, t: 'R', g, rpc: rpc || '', ...(l ? { l } : {}) });
  const A = (n, g, rpc, l, fin) => ({ n, t: 'A', g, rpc: rpc || '', ...(l ? { l } : {}), ...(fin ? { fin } : {}) });
  const P = (n, g, rpc, l) => ({ n, t: 'P', g, rpc: rpc || '', ...(l ? { l } : {}) });
  const N = (n) => ({ n, t: 'N', g: '', rpc: '' });
  const CONTI_DEFAULT = [
    // costi
    C('Tesseramento (affiliazioni e tessere)', 'tess', 'CA7'),
    C('Affitto sede', 'sede', 'CA3'),
    C('Spese manutenzione sede', 'sede', 'CA2'),
    C('Spese utilizzo impianti', 'sede', 'CA3'),
    C('Spese telefoniche', 'gen', 'CE2'),
    C('Spese postali', 'gen', 'CE2'),
    C('Energia elettrica, gas, acqua', 'gen', 'CE2'),
    C('Assicurazioni', 'gen', 'CA2'),
    C('Spese pulizia', 'gen', 'CA2'),
    C('Acquisto cancelleria', 'gen', 'CE7'),
    C('Spese di gestione', 'gen', 'CA2'),
    C('Spese varie', 'gen', 'CA1'),
    C('Spese per visite mediche', 'gen', 'CA2'),
    C('Compensi soci allenatori', 'corsi', 'CA2'),
    C('Compensi collaboratori', 'corsi', 'CA2'),
    C('Rimborso spese viaggio', 'corsi', 'CA2'),
    C('Materiali per attività sportiva', 'corsi', 'CA1'),
    C('Materiali di consumo', 'corsi', 'CA1'),
    C('Attrezzature per palestra', 'corsi', 'CA1'),
    C('Costi di pubblicità', 'corsi', 'CA2', 'Costi pubblicità attività sportive'),
    C('Iscrizioni e tasse gara', 'corsi', 'CA7'),
    C('Compensi giudici di gara', 'corsi', 'CA2'),
    C('Spese bancarie', 'ofin', 'CE2'),
    C('Imposta intrattenimento', 'trib', 'IM'),
    C('Imposte dirette (IRES e IRAP)', 'trib', 'IM'),
    C('Spese di gestione diverse', 'manc', 'CB2'),
    C('Spese per raccolte pubbliche di fondi', 'manc', 'CC2', 'Raccolte pubbliche di fondi'),
    // ricavi
    R('Quote sociali', 'quote', 'RA1'),
    R('Contributi statali', 'cpub', 'RA8'),
    R('Contributo Regione Piemonte', 'cpub', 'RA8', 'Contributi regionali'),
    R('Contributo Comune', 'cpub', 'RA8', 'Contributi Comune'),
    R('Contributi da convenzioni con Enti', 'cpub', 'RA8', 'Contributi da convenzioni con enti'),
    R('Donazioni ed erogazioni liberali', 'cpriv', 'RA4'),
    R('Contributi da soci e/o privati', 'cpriv', 'RA6'),
    R('Quote partecipazione attività sport.', 'att', 'RA2'),
    R('Quote partecipazione corsi', 'att', 'RA2'),
    R('Interessi attivi', 'pfin', 'RA10'),
    R('Ricavi da pubblicità', 'rpub', 'RB3'),
    R('Ricavi da sponsorizzazione', 'rpub', 'RB3'),
    R('Proventi da vendita biglietti', 'manr', 'RB3'),
    R('Raccolte pubbliche di fondi', 'manr', 'RC2'),
    R('Proventi da collaborazioni con terzi', 'serv', 'RB3'),
    R('Proventi da convenzioni con Enti', 'serv', 'RB5'),
    // attività
    A('Cassa Alessandria', 'disp', '', '', 'cassa'),
    A('Banca', 'disp', '', 'Banca, Paypal e Sumup', 'banca'),
    A('Clienti', 'cred'),
    A('Soci', 'cred'),
    A('Diversi', 'cred'),
    A('Fornitori c/anticipi', 'cred', '', 'Fornitori'),
    A('Fabbricati', 'immo', 'CF1'),
    A('Mobili arredi', 'immo', 'CF1'),
    A('Attrezzature', 'immo', 'CF1'),
    // passività
    P('Finanziamenti banche', 'pfinz', 'RF4'),
    P('Finanziamenti dai soci', 'pfinz', 'RF4'),
    P('Fornitori', 'deb'),
    P('Enti', 'deb'),
    P('Debiti diversi', 'deb', '', 'Diversi'),
    P('F.do amm.to fabbricati', 'famm', '', 'Fabbricati'),
    P('F.do amm.to mobili arredi', 'famm', '', 'Mobili arredi'),
    P('F.do amm.to attrezzature', 'famm', '', 'Attrezzature'),
    P('F.do svalutazione crediti', 'facc', '', 'Svalutazione crediti'),
    P('Debiti per TFR', 'facc'),
    // netto (scrittura di apertura)
    N("Avanzo dell'esercizio"),
    N('Fondo comune'),
    N('Disavanzo dell’esercizio')
  ];

  // Rendiconto per Cassa (modello ETS, righe come nel foglio originale)
  const L = (r, Lc, Ll, Rc, Rl) => ({ r, t: 'line', Lc, L: Ll, Rc, R: Rl });
  const RPC_ROWS = [
    { r: 5, t: 'hdr', L: 'USCITE', R: 'ENTRATE' },
    { r: 6, t: 'sec', L: 'A) Uscite da attività di interesse generale', R: 'A) Entrate da attività di interesse generale' },
    L(7, 'CA1', '1) Materie prime, sussidiarie, di consumo e di merci', 'RA1', '1) Entrate da quote associative e apporti dei fondatori'),
    L(8, 'CA2', '2) Servizi', 'RA2', '2) Entrate dagli associati per attività mutuali'),
    L(9, 'CA3', '3) Godimento beni di terzi', 'RA3', '3) Entrate per prestazioni di servizi e cessioni ad associati e fondatori'),
    L(10, 'CA4', '4) Personale', 'RA4', '4) Erogazioni liberali'),
    L(11, 'CA7', '5) Uscite diverse di gestione', 'RA5', '5) Entrate del 5 per mille'),
    L(12, null, null, 'RA6', '6) Contributi da soggetti privati'),
    L(13, null, null, 'RA7', '7) Entrate per prestazioni e cessioni a terzi'),
    L(14, null, null, 'RA8', '8) Contributi da enti pubblici'),
    L(15, null, null, 'RA9', '9) Entrate da contratti con enti pubblici'),
    L(16, null, null, 'RA10', '10) Altre entrate'),
    { r: 17, t: 'tot', Lsum: [7, 11], Rsum: [7, 16] },
    { r: 18, t: 'diff', R: 'Avanzo/disavanzo attività di interesse generale (+/-)', of: 17 },
    { r: 19, t: 'sec', L: 'B) Uscite da attività diverse', R: 'B) Entrate da attività diverse' },
    L(20, 'CB1', '1) Materie prime, sussidiarie, di consumo e di merci', 'RB1', '1) Entrate per prestazioni e cessioni ad associati e fondatori'),
    L(21, 'CB2', '2) Servizi', 'RB2', '2) Contributi da soggetti privati'),
    L(22, 'CB3', '3) Godimento beni di terzi', 'RB3', '3) Entrate per prestazioni e cessioni a terzi'),
    L(23, 'CB4', '4) Personale', 'RB4', '4) Contributi da enti pubblici'),
    L(24, 'CB7', '5) Uscite diverse di gestione', 'RB5', '5) Entrate da contratti con enti pubblici'),
    L(25, null, null, 'RB6', '6) Altre entrate'),
    { r: 26, t: 'tot', Lsum: [20, 25], Rsum: [20, 25] },
    { r: 27, t: 'diff', R: 'Avanzo/disavanzo attività diverse (+/-)', of: 26 },
    { r: 28, t: 'sec', L: 'C) Uscite da attività di raccolta fondi', R: 'C) Entrate da attività di raccolta fondi' },
    L(29, 'CC1', '1) Uscite per raccolte fondi abituali', 'RC1', '1) Entrate da raccolte fondi abituali'),
    L(30, 'CC2', '2) Uscite per raccolte fondi occasionali', 'RC2', '2) Entrate da raccolte fondi occasionali'),
    L(31, 'CC3', '3) Altre uscite', 'RC3', '3) Altre entrate'),
    { r: 32, t: 'tot', Lsum: [29, 31], Rsum: [29, 31] },
    { r: 33, t: 'diff', R: 'Avanzo/disavanzo attività di raccolta fondi (+/-)', of: 32 },
    { r: 34, t: 'sec', L: 'D) Uscite da attività finanziarie e patrimoniali', R: 'D) Entrate da attività finanziarie e patrimoniali' },
    L(35, 'CD1', '1) Su rapporti bancari', 'RD1', '1) Da rapporti bancari'),
    L(36, 'CD2', '2) Su investimenti finanziari', 'RD2', '2) Da investimenti finanziari'),
    L(37, 'CD3', '3) Su patrimonio edilizio', 'RD3', '3) Da patrimonio edilizio'),
    L(38, 'CD4', '4) Su altri beni patrimoniali', 'RD4', '4) Da altri beni patrimoniali'),
    L(39, 'CD6', '5) Altre uscite', 'RD5', '5) Altre entrate'),
    { r: 40, t: 'tot', Lsum: [35, 39], Rsum: [35, 39] },
    { r: 41, t: 'diff', R: 'Avanzo/disavanzo attività finanziarie e patrimoniali (+/-)', of: 40 },
    { r: 42, t: 'sec', L: 'E) Uscite di supporto generale', R: 'E) Entrate di supporto generale' },
    L(43, 'CE1', '1) Materie prime, sussidiarie, di consumo e di merci', 'RE1', '1) Entrate da distacco del personale'),
    L(44, 'CE2', '2) Servizi', 'RE2', '2) Altre entrate di supporto generale'),
    L(45, 'CE3', '3) Godimento beni di terzi', null, null),
    L(46, 'CE4', '4) Personale', null, null),
    L(47, 'CE7', '5) Uscite diverse di gestione', null, null),
    { r: 48, t: 'tot', Lsum: [43, 47], Rsum: [43, 47] },
    { r: 49, t: 'gtot', L: 'Totale uscite della gestione', R: 'Totale entrate della gestione', of: [17, 26, 32, 40, 48] },
    { r: 50, t: 'res', A: "Avanzo/disavanzo d'esercizio prima delle imposte (+/-)", f: 'gestione' },
    { r: 51, t: 'imp', code: 'IM', label: 'Imposte' },
    { r: 52, t: 'res', A: "Avanzo/disavanzo d'esercizio prima di investimenti e disinvestimenti patrimoniali e finanziamenti (+/-)", f: 'dopoImposte' },
    { r: 54, t: 'hdr2', L: 'Uscite da investimenti in immobilizzazioni o da deflussi di capitale di terzi', R: 'Entrate da disinvestimenti in immobilizzazioni o da flussi di capitale di terzi' },
    L(55, 'CF1', '1) Investimenti in immobilizzazioni inerenti alle attività di interesse generale', 'RF1', '1) Disinvestimenti di immobilizzazioni inerenti alle attività di interesse generale'),
    L(56, 'CF2', '2) Investimenti in immobilizzazioni inerenti alle attività diverse', 'RF2', '2) Disinvestimenti di immobilizzazioni inerenti alle attività diverse'),
    L(57, 'CF3', '3) Investimenti in attività finanziarie e patrimoniali', 'RF3', '3) Disinvestimenti di attività finanziarie e patrimoniali'),
    L(58, 'CF4', '4) Rimborso di finanziamenti per quota capitale e di prestiti', 'RF4', '4) Ricevimento di finanziamenti e di prestiti'),
    { r: 59, t: 'tot', Lsum: [55, 58], Rsum: [55, 58] },
    { r: 60, t: 'imp', code: 'IMRC', label: 'Imposte' },
    { r: 61, t: 'res', A: 'Avanzo/disavanzo da entrate e uscite per investimenti e disinvestimenti patrimoniali e finanziamenti (+/-)', f: 'investimenti' },
    { r: 63, t: 'dates' },
    { r: 64, t: 'res', A: "Avanzo/disavanzo d'esercizio prima di investimenti e disinvestimenti patrimoniali e finanziamenti (+/-)", f: 'ref52' },
    { r: 65, t: 'res', A: 'Avanzo/disavanzo da entrate e uscite per investimenti e disinvestimenti patrimoniali e finanziamenti (+/-)', f: 'ref61' },
    { r: 66, t: 'res', A: 'Avanzo/disavanzo complessivo (+/-)', f: 'complessivo' },
    { r: 68, t: 'dates' },
    { r: 69, t: 'cb', code: 'ACIV', label: 'Cassa e banca', bold: true },
    { r: 70, t: 'cb', code: 'ACIV3', label: 'Cassa', fin: 'cassa' },
    { r: 71, t: 'cb', code: 'ACIV1', label: 'Depositi bancari e postali', fin: 'banca' }
  ];
  const RPC_CODES = [];
  RPC_ROWS.forEach((row) => {
    if (row.t === 'line') {
      if (row.Lc) RPC_CODES.push({ code: row.Lc, label: row.L, side: 'U' });
      if (row.Rc) RPC_CODES.push({ code: row.Rc, label: row.R, side: 'E' });
    } else if (row.t === 'imp') RPC_CODES.push({ code: row.code, label: row.label + (row.code === 'IMRC' ? ' (investimenti)' : ''), side: 'U' });
  });
  const rpcSide = (code) => (code && (code[0] === 'R') ? 'E' : 'U');
  function rpcSection(code) {
    if (!code) return '';
    if (code === 'IM' || code === 'IMRC') return 'Imposte';
    const s = code[1];
    return { A: 'A) Interesse generale', B: 'B) Attività diverse', C: 'C) Raccolta fondi', D: 'D) Finanziarie e patrimoniali', E: 'E) Supporto generale', F: 'Investimenti e finanziamenti' }[s] || '';
  }

  // ---------------------------------------------------------------- impostazioni
  function nuoveImpostazioni(es) {
    const [y1, y2] = (es || '2026-2027').split('-').map(Number);
    return {
      nome: '',
      es: y1 + '-' + y2,
      inizio: y1 + '-09-01',
      fine: y2 + '-08-31',
      saldi: { cassa: 0, banca: 0 },
      fondo: 0,
      par: { quotaAssoc: 25, quotaMese: 50, sumup: 1.95, bonifico: 0.74, ricevute: true },
      conti: CONTI_DEFAULT.map((c) => ({ ...c })),
      rpcPrec: {},
      contributi: { entrate: [], uscite: [] }
    };
  }
  function mesiEsercizio(s) {
    const out = [];
    let ym = s.inizio.slice(0, 7);
    const end = s.fine.slice(0, 7);
    for (let i = 0; i < 24 && ym <= end; i++) { out.push(ym); ym = addMonths(ym, 1); }
    return out;
  }
  function chiaveMese(op, s) {
    if (op.data && op.data >= s.inizio && op.data <= s.fine) return 'm-' + op.data.slice(0, 7);
    return 'm-altro';
  }
  function contoMap(s) {
    const m = new Map();
    s.conti.forEach((c) => m.set(c.n, c));
    return m;
  }
  function contoFin(s, ruolo) {
    return s.conti.find((c) => c.fin === ruolo) || { n: ruolo === 'cassa' ? 'Cassa Alessandria' : 'Banca', l: '' };
  }
  const etichetta = (c) => (c && (c.l || c.n)) || '';

  // ---------------------------------------------------------------- operazioni
  function ordina(ops) {
    return ops.slice().sort((a, b) => (a.ord - b.ord) || String(a.id).localeCompare(String(b.id)));
  }
  function numera(sorted) {
    const base = sorted[0] && sorted[0].tipo === 'apertura' ? 0 : 1;
    sorted.forEach((o, i) => { o._n = i + base; });
    return sorted;
  }
  function totaliOp(op) {
    let d = 0, a = 0;
    op.righe.forEach((r) => { d += num(r.dare); a += num(r.avere); });
    return { dare: r2(d), avere: r2(a), diff: r2(d - a) };
  }
  function saldiConti(ops) {
    const bal = new Map();
    ops.forEach((op) => op.righe.forEach((r) => {
      if (!r.conto) return;
      const b = bal.get(r.conto) || { d: 0, a: 0, n: 0 };
      b.d += num(r.dare); b.a += num(r.avere); b.n += 1;
      bal.set(r.conto, b);
    }));
    bal.forEach((b) => { b.d = r2(b.d); b.a = r2(b.a); });
    return bal;
  }
  function valoreConto(c, bal) {
    const b = bal.get(c.n);
    if (!b) return 0;
    return (c.t === 'C' || c.t === 'A') ? r2(b.d - b.a) : r2(b.a - b.d);
  }

  // Registro cassa derivato dal Libro Giornale
  function registroCassa(sortedOps, s) {
    const cassa = contoFin(s, 'cassa').n, banca = contoFin(s, 'banca').n;
    let sc = num(s.saldi.cassa), sb = num(s.saldi.banca);
    const rows = [];
    let te = { ce: 0, cu: 0, be: 0, bu: 0 };
    sortedOps.forEach((op) => {
      let nc = 0, nb = 0, tocca = false;
      op.righe.forEach((r) => {
        if (r.conto === cassa) { nc += num(r.dare) - num(r.avere); tocca = true; }
        if (r.conto === banca) { nb += num(r.dare) - num(r.avere); tocca = true; }
      });
      if (!tocca) return;
      nc = r2(nc); nb = r2(nb);
      const row = {
        op, n: op._n, data: op.data, desc: op.descCassa || descCassaAuto(op),
        ce: nc > 0 ? nc : 0, cu: nc < 0 ? -nc : 0, be: nb > 0 ? nb : 0, bu: nb < 0 ? -nb : 0
      };
      sc = r2(sc + nc); sb = r2(sb + nb);
      row.sc = sc; row.sb = sb;
      te.ce += row.ce; te.cu += row.cu; te.be += row.be; te.bu += row.bu;
      rows.push(row);
    });
    Object.keys(te).forEach((k) => { te[k] = r2(te[k]); });
    return { rows, finale: { cassa: sc, banca: sb }, totali: te };
  }
  function descCassaAuto(op) {
    const first = op.righe.find((r) => !/^(Versamento in|Pagamento per|Spese transazione)/i.test(r.desc || ''));
    return clean((first || op.righe[0] || {}).desc || '');
  }

  // ---------------------------------------------------------------- report
  function rendicontoEconomico(s, bal) {
    const lato = (sezioni, tipo) => sezioni.map((sez) => {
      const gruppi = sez.gruppi.map((g) => {
        const conti = s.conti.filter((c) => c.t === tipo && c.g === g.id);
        const voci = conti.map((c) => ({ conto: c, label: etichetta(c), v: valoreConto(c, bal) }));
        const v = r2(voci.reduce((x, y) => x + y.v, 0));
        const single = g.single && conti.length <= 1;
        return { ...g, voci, v, single };
      });
      return { ...sez, gruppi, v: r2(gruppi.reduce((x, y) => x + y.v, 0)) };
    });
    const costi = lato(RE.costi, 'C');
    const ricavi = lato(RE.ricavi, 'R');
    const totC = r2(costi.reduce((x, y) => x + y.v, 0));
    const totR = r2(ricavi.reduce((x, y) => x + y.v, 0));
    const saldo = r2(totR - totC);
    return { costi, ricavi, totC, totR, saldo, avanzo: saldo > 0 ? saldo : 0, disavanzo: saldo < 0 ? -saldo : 0 };
  }
  function statoPatrimoniale(s, bal, re) {
    const lato = (gruppi, tipo) => gruppi.map((g) => {
      const conti = s.conti.filter((c) => c.t === tipo && c.g === g.id);
      const voci = conti.map((c) => {
        let v = valoreConto(c, bal);
        if (c.fin === 'cassa') v = r2(v + num(s.saldi.cassa));
        if (c.fin === 'banca') v = r2(v + num(s.saldi.banca));
        return { conto: c, label: etichetta(c), v };
      });
      return { ...g, voci, v: r2(voci.reduce((x, y) => x + y.v, 0)) };
    });
    const attivo = lato(SP.attivo, 'A');
    const passivo = lato(SP.passivo, 'P');
    const totA = r2(attivo.reduce((x, y) => x + y.v, 0));
    const totP = r2(passivo.reduce((x, y) => x + y.v, 0));
    const fondo = num(s.fondo);
    const parA = r2(totA + re.disavanzo);
    const parP = r2(totP + re.avanzo + fondo);
    return { attivo, passivo, totA, totP, fondo, avanzo: re.avanzo, disavanzo: re.disavanzo, parA, parP, quadra: Math.abs(parA - parP) < 0.005 };
  }
  function rendicontoCassa(s, bal, finali) {
    const cur = {};
    s.conti.forEach((c) => {
      if (!c.rpc) return;
      const b = bal.get(c.n);
      if (!b) return;
      const v = rpcSide(c.rpc) === 'E' ? b.a - b.d : b.d - b.a;
      cur[c.rpc] = r2((cur[c.rpc] || 0) + v);
    });
    const prev = s.rpcPrec || {};
    const val = (side, code) => num(side === 'cur' ? cur[code] : prev[code]);
    const out = { cur: {}, prev: {} };
    ['cur', 'prev'].forEach((k) => {
      const V = out[k];
      const lineVal = (rowNum, lato) => {
        const row = RPC_ROWS.find((x) => x.r === rowNum);
        const code = lato === 'L' ? row.Lc : row.Rc;
        return code ? val(k, code) : 0;
      };
      const sum = (rng, lato) => {
        let t = 0;
        for (let r = rng[0]; r <= rng[1]; r++) {
          const row = RPC_ROWS.find((x) => x.r === r);
          if (row && row.t === 'line') t += lineVal(r, lato);
        }
        return r2(t);
      };
      RPC_ROWS.forEach((row) => {
        if (row.t === 'tot') { V['L' + row.r] = sum(row.Lsum, 'L'); V['R' + row.r] = sum(row.Rsum, 'R'); }
      });
      RPC_ROWS.forEach((row) => {
        if (row.t === 'diff') V['R' + row.r] = r2(V['R' + row.of] - V['L' + row.of]);
        if (row.t === 'gtot') {
          V['L' + row.r] = r2(row.of.reduce((x, r) => x + V['L' + r], 0));
          V['R' + row.r] = r2(row.of.reduce((x, r) => x + V['R' + r], 0));
        }
        if (row.t === 'imp') V['R' + row.r] = val(k, row.code);
      });
      V.R50 = r2(V.R49 - V.L49);
      V.R52 = r2(V.R50 - V.R51);
      V.R61 = r2(V.R59 - V.L59 - V.R60);
      V.R64 = V.R52;
      V.R65 = V.R61;
      V.R66 = r2(V.R64 + V.R65);
      V.R70 = k === 'cur' ? finali.cassa : num(s.saldi.cassa);
      V.R71 = k === 'cur' ? finali.banca : num(s.saldi.banca);
    });
    out.codes = { cur, prev };
    return out;
  }

  function calcola(s, ops) {
    const sorted = numera(ordina(ops));
    const bal = saldiConti(sorted);
    const cassa = registroCassa(sorted, s);
    const re = rendicontoEconomico(s, bal);
    const sp = statoPatrimoniale(s, bal, re);
    const rpc = rendicontoCassa(s, bal, cassa.finale);
    const cm = contoMap(s);
    const avvisi = [];
    bal.forEach((b, nome) => {
      const c = cm.get(nome);
      if (!c) avvisi.push({ tipo: 'conto', conto: nome, msg: 'Il conto «' + nome + '» è usato nel Libro Giornale ma non è nel piano dei conti.' });
      else if (c.t !== 'N' && !c.g) avvisi.push({ tipo: 'gruppo', conto: nome, msg: 'Il conto «' + nome + '» non è collegato a nessuna voce di bilancio.' });
      else if ((c.t === 'C' || c.t === 'R') && !c.rpc && Math.abs(b.d - b.a) > 0.004) avvisi.push({ tipo: 'rpc', conto: nome, msg: 'Il conto «' + nome + '» non è collegato al Rendiconto per Cassa.' });
    });
    let sbil = [];
    sorted.forEach((op) => { const t = totaliOp(op); if (Math.abs(t.diff) > 0.004) sbil.push(op); });
    if (sbil.length) avvisi.push({ tipo: 'sbilancio', msg: sbil.length + ' operazion' + (sbil.length > 1 ? 'i non quadrano' : 'e non quadra') + ' (Dare ≠ Avere): n. ' + sbil.map((o) => o._n).join(', ') });
    let td = 0, ta = 0;
    bal.forEach((b) => { td += b.d; ta += b.a; });
    return { sorted, bal, cassa, re, sp, rpc, avvisi, totDare: r2(td), totAvere: r2(ta) };
  }

  // ---------------------------------------------------------------- soci
  const RX_ASSOC = /^Quota associa(?:zione|tiva)\s+socio\s+(.+?)\s*$/i;
  const RX_PART = /^Quota partecip(?:\.|azione)\s+(att\.\s*sport\.|corsi)\s+socio\s+(.+?)\s+(\d{2}(?:\/\d{2})?(?:-\d{2}\/\d{2})?)\s*$/i;
  // descrizioni senza mese (es. "… socio Rossi M./26"): importo valido, mese sconosciuto
  const RX_PART_NOMESE = /^Quota partecip(?:\.|azione)\s+(att\.\s*sport\.|corsi)\s+socio\s+(.+?)\s*(?:\/\d{2})?\s*$/i;
  function parsePeriodo(p) {
    const m = /^(\d{2})(?:\/(\d{2}))?(?:-(\d{2})\/(\d{2}))?$/.exec(p || '');
    if (!m) return [];
    let m1 = m[1], y1 = m[2], m2 = m[3], y2 = m[4];
    if (!y1 && !y2) return [];
    if (!y1) y1 = y2;
    const a = '20' + y1 + '-' + m1;
    if (!m2) return [a];
    const b = '20' + y2 + '-' + m2;
    const out = [];
    let x = a;
    for (let i = 0; i < 24 && x <= b; i++) { out.push(x); x = addMonths(x, 1); }
    return out;
  }
  function formatPeriodo(a, b) {
    if (!a) return '';
    if (!b || b === a) return ymLabel(a);
    if (a.slice(0, 4) === b.slice(0, 4)) return a.slice(5, 7) + '-' + b.slice(5, 7) + '/' + a.slice(2, 4);
    return ymLabel(a) + '-' + ymLabel(b);
  }
  const chiaveSocio = (n) => clean(n).toLowerCase();
  // mesi segnati a mano come pagati su un'operazione (la descrizione resta com'è):
  // op.mesiForzati = [{ socio: 'Cermelli F.', mesi: ['2026-10'] }]
  function mesiForzatiOp(op) {
    return (Array.isArray(op.mesiForzati) ? op.mesiForzati : []).filter((x) => x && clean(x.socio) && Array.isArray(x.mesi) && x.mesi.length);
  }
  // nomi dei soci che compaiono nelle quote di un'operazione
  function sociOperazione(op) {
    const out = [];
    (op.righe || []).forEach((r) => {
      const d = clean(r.desc);
      const m = RX_ASSOC.exec(d) || RX_PART.exec(d) || RX_PART_NOMESE.exec(d);
      if (!m) return;
      const nome = clean(RX_ASSOC.test(d) ? m[1] : m[2]);
      if (!out.some((x) => chiaveSocio(x) === chiaveSocio(nome))) out.push(nome);
    });
    return out;
  }
  function situazioneSoci(sortedOps) {
    const soci = new Map();
    const get = (nome) => {
      const k = chiaveSocio(nome);
      if (!soci.has(k)) soci.set(k, { nome: clean(nome), assoc: [], part: [], mesi: new Set(), forzati: new Map(), totale: 0, ultimo: null });
      return soci.get(k);
    };
    sortedOps.forEach((op) => {
      const partOp = new Map();
      op.righe.forEach((r) => {
        const d = clean(r.desc);
        let m = RX_ASSOC.exec(d);
        const imp = r2(num(r.avere) - num(r.dare));
        if (m) {
          const s = get(m[1]);
          s.assoc.push({ data: op.data, n: op._n, importo: imp });
          s.totale = r2(s.totale + imp);
          s.ultimo = op.data || s.ultimo;
          return;
        }
        m = RX_PART.exec(d) || RX_PART_NOMESE.exec(d);
        if (m) {
          const s = get(m[2]);
          const mesi = m[3] ? parsePeriodo(m[3]) : [];
          if (!mesi.length) s.senzaMese = (s.senzaMese || 0) + 1;
          const v = { data: op.data, n: op._n, importo: imp, mesi, tipo: /corsi/i.test(m[1]) ? 'corsi' : 'att', conto: r.conto };
          s.part.push(v);
          partOp.set(chiaveSocio(m[2]), v);
          mesi.forEach((x) => s.mesi.add(x));
          s.totale = r2(s.totale + imp);
          s.ultimo = op.data || s.ultimo;
        }
      });
      mesiForzatiOp(op).forEach((f) => {
        const s = get(f.socio);
        const v = partOp.get(chiaveSocio(f.socio));
        // la quota di quell'operazione copre anche i mesi segnati a mano (per la quota mensile proposta)
        if (v) v.mesi = Array.from(new Set(v.mesi.concat(f.mesi))).sort();
        f.mesi.forEach((x) => { s.mesi.add(x); s.forzati.set(x, op._n); });
      });
    });
    return soci;
  }
  function statoSocio(soci, nome, s) {
    const x = soci.get(chiaveSocio(nome));
    if (!x) return { nuovo: true, assoc: null, mesi: [], prossimo: null, quotaMese: null };
    const mesi = Array.from(x.mesi).sort();
    const last = x.part[x.part.length - 1];
    const quotaMese = last && last.mesi.length ? r2(last.importo / last.mesi.length) : null;
    const meseEs = mesiEsercizio(s);
    const ni = nonIncassareSocio(s, x.nome);
    let prossimo = null;
    if (mesi.length) {
      const nx = addMonths(mesi[mesi.length - 1], 1);
      prossimo = nx;
      // salta i mesi da non incassare (grigi nel registro), se dopo ne resta uno da pagare
      // fin dove arrivano le colonne dei suoi corsi (il basket finisce a maggio): oltre non si salta
      const fino = ni.fino || (s && s.registro && s.registro.nonIncassare && s.registro.nonIncassare.fino) || meseEs[meseEs.length - 1];
      let y = nx;
      while (ni.mesi.has(y) && y <= fino) y = addMonths(y, 1);
      if (y <= fino) prossimo = y;
    }
    if (!prossimo || prossimo < meseEs[0]) prossimo = null;
    return { nuovo: false, nome: x.nome, assoc: x.assoc[x.assoc.length - 1] || null, assocNonDovuta: !x.assoc.length && ni.assoc, nonIncassare: ni.mesi, mesi, prossimo, quotaMese, tipo: last ? last.tipo : 'att', totale: x.totale };
  }

  // ---------------------------------------------------------------- generatori di scritture
  function commissione(importo, pct) {
    return Math.round(num(importo) * num(pct) + 1e-7) / 100;
  }
  function joinSoci(nomi) {
    const n = nomi.map((x) => 'socio ' + x);
    if (n.length <= 1) return n.join('');
    return n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
  }
  const versamento = (fin, s) => (fin === 'cassa' ? 'Versamento in ' + contoFin(s, 'cassa').n.replace(/^Cassa/, 'cassa') : 'Versamento in banca');
  const pagamento = (fin, s) => (fin === 'cassa' ? 'Pagamento per ' + contoFin(s, 'cassa').n.replace(/^Cassa/, 'cassa') : 'Pagamento per banca');

  // form: {data, mezzo:'contanti'|'banca'|'sumup', commissione, soci:[{nome, assoc, impAssoc, part, tipoPart, da, a, impPart, ric}]}
  function scritturaQuote(f, s) {
    const righe = [];
    let tot = 0;
    const nomi = [];
    let anyAssoc = false, anyPart = false, anyCorsi = false;
    const periodi = new Set();
    (f.soci || []).forEach((so) => {
      const nome = clean(so.nome);
      if (!nome) return;
      let first = true;
      const ric = s.par.ricevute && isNum(so.ric) ? Number(so.ric) : null;
      if (so.assoc && num(so.impAssoc) > 0) {
        righe.push({ desc: 'Quota associazione socio ' + nome, dare: null, avere: r2(so.impAssoc), conto: 'Quote sociali', ric: first ? ric : null });
        first = false; tot += num(so.impAssoc); anyAssoc = true;
      }
      if (so.part && num(so.impPart) > 0 && so.da) {
        const per = formatPeriodo(so.da, so.a || so.da);
        const corsi = so.tipoPart === 'corsi';
        righe.push({
          desc: (corsi ? 'Quota partecip. corsi socio ' : 'Quota partecip. att. sport. socio ') + nome + ' ' + per,
          dare: null, avere: r2(so.impPart), conto: corsi ? 'Quote partecipazione corsi' : 'Quote partecipazione attività sport.', ric: first ? ric : null
        });
        first = false; tot += num(so.impPart); anyPart = true; if (corsi) anyCorsi = true; periodi.add(per);
      }
      if (!first && !nomi.includes(nome)) nomi.push(nome);
    });
    tot = r2(tot);
    if (!righe.length) return { righe: [], descCassa: '', totale: 0, netto: 0, comm: 0 };
    // come nel Libro Giornale: prima tutte le quote associative, poi le quote di partecipazione
    righe.sort((a, b) => (a.conto === 'Quote sociali' ? 0 : 1) - (b.conto === 'Quote sociali' ? 0 : 1));
    const fin = f.mezzo === 'contanti' ? 'cassa' : 'banca';
    let comm = 0;
    if (f.mezzo === 'sumup') {
      comm = isNum(f.commissione) ? r2(f.commissione) : commissione(tot, s.par.sumup);
      if (comm > 0) righe.push({ desc: 'Spese transazione pagamento elettronico SumUp', dare: comm, avere: null, conto: 'Spese bancarie', ric: null });
    }
    const netto = r2(tot - comm);
    righe.push({ desc: versamento(fin, s), dare: netto, avere: null, conto: contoFin(s, fin).n, ric: null });
    const parti = [];
    if (anyAssoc) parti.push('Quota assoc.');
    if (anyPart) parti.push((anyCorsi ? 'Quota part. corsi' : 'Quota part. att. sport.') + ' - ' + Array.from(periodi).join(', '));
    const descCassa = parti.join(' + ') + ' ' + joinSoci(nomi);
    return { righe, descCassa, totale: tot, netto, comm };
  }
  // form: {data, mezzo:'contanti'|'bonifico'|'banca', voci:[{desc, conto, importo}], commissione, conComm}
  function scritturaSpesa(f, s) {
    const righe = [];
    let tot = 0;
    (f.voci || []).forEach((v) => {
      if (!clean(v.desc) && !num(v.importo)) return;
      righe.push({ desc: clean(v.desc), dare: r2(v.importo), avere: null, conto: v.conto, ric: null });
      tot += num(v.importo);
    });
    if (!righe.length) return { righe: [], descCassa: '', totale: 0 };
    if (f.mezzo === 'bonifico' && f.conComm && num(f.commissione) > 0) {
      righe.push({ desc: 'Spese bancarie per bonifico', dare: r2(f.commissione), avere: null, conto: 'Spese bancarie', ric: null });
      tot += num(f.commissione);
    }
    tot = r2(tot);
    const fin = f.mezzo === 'contanti' ? 'cassa' : 'banca';
    righe.push({ desc: pagamento(fin, s), dare: null, avere: tot, conto: contoFin(s, fin).n, ric: null });
    const descs = (f.voci || []).map((v) => clean(v.desc)).filter(Boolean);
    const descCassa = descs.length > 1 && descs.every((d) => d === descs[0]) ? descs[0] : descs.join(' + ');
    return { righe, descCassa, totale: tot };
  }
  // form: {data, mezzo:'contanti'|'banca'|'sumup', voci:[{desc, conto, importo}], commissione}
  function scritturaIncasso(f, s) {
    const righe = [];
    let tot = 0;
    (f.voci || []).forEach((v) => {
      if (!clean(v.desc) && !num(v.importo)) return;
      righe.push({ desc: clean(v.desc), dare: null, avere: r2(v.importo), conto: v.conto, ric: null });
      tot += num(v.importo);
    });
    tot = r2(tot);
    if (!righe.length) return { righe: [], descCassa: '', totale: 0 };
    const fin = f.mezzo === 'contanti' ? 'cassa' : 'banca';
    let comm = 0;
    if (f.mezzo === 'sumup') {
      comm = isNum(f.commissione) ? r2(f.commissione) : commissione(tot, s.par.sumup);
      if (comm > 0) righe.push({ desc: 'Spese transazione pagamento elettronico SumUp', dare: comm, avere: null, conto: 'Spese bancarie', ric: null });
    }
    righe.push({ desc: versamento(fin, s), dare: r2(tot - comm), avere: null, conto: contoFin(s, fin).n, ric: null });
    const descs = (f.voci || []).map((v) => clean(v.desc)).filter(Boolean);
    return { righe, descCassa: descs.join(' + '), totale: tot, comm };
  }
  // form: {data, verso:'versamento'|'prelievo', importo}
  function scritturaGiroconto(f, s) {
    const imp = r2(f.importo);
    if (!(imp > 0)) return { righe: [], descCassa: '', totale: 0 };
    const cassa = contoFin(s, 'cassa').n, banca = contoFin(s, 'banca').n;
    if (f.verso === 'prelievo') {
      return {
        righe: [
          { desc: versamento('cassa', s), dare: imp, avere: null, conto: cassa, ric: null },
          { desc: pagamento('banca', s), dare: null, avere: imp, conto: banca, ric: null }],
        descCassa: 'Prelievo da c/c bancario per ' + cassa.replace(/^Cassa/, 'cassa'), totale: imp
      };
    }
    return {
      righe: [
        { desc: 'Versamento in banca', dare: imp, avere: null, conto: banca, ric: null },
        { desc: pagamento('cassa', s), dare: null, avere: imp, conto: cassa, ric: null }],
      descCassa: 'Versamento ' + cassa.replace(/^Cassa/, 'cassa') + ' su c/c bancario', totale: imp
    };
  }
  function prossimaRicevuta(sortedOps) {
    let mx = 0;
    sortedOps.forEach((op) => op.righe.forEach((r) => { if (isNum(r.ric)) mx = Math.max(mx, Number(r.ric)); }));
    return mx + 1;
  }

  // Suggerimenti dalle registrazioni precedenti
  function storicoVoci(sortedOps, s) {
    const cm = contoMap(s);
    const map = new Map();
    sortedOps.forEach((op) => {
      const finR = op.righe.find((r) => { const c = cm.get(r.conto); return c && c.fin; });
      op.righe.forEach((r) => {
        const c = cm.get(r.conto);
        if (!c || (c.t !== 'C' && c.t !== 'R')) return;
        const d = clean(r.desc);
        if (!d || RX_ASSOC.test(d) || RX_PART.test(d) || RX_PART_NOMESE.test(d) || /^Spese (transazione|bancarie per bonifico)/i.test(d)) return;
        const k = d.toLowerCase();
        const e = map.get(k) || { desc: d, volte: 0 };
        e.volte += 1;
        e.conto = r.conto;
        e.tipo = c.t;
        e.importo = c.t === 'C' ? num(r.dare) : num(r.avere);
        e.fin = finR ? cm.get(finR.conto).fin : null;
        e.bonifico = op.righe.some((x) => /^Spese bancarie per bonifico/i.test(x.desc || ''));
        e.data = op.data;
        map.set(k, e);
      });
    });
    return map;
  }

  // ---------------------------------------------------------------- registro dei pagamenti dei corsi
  // File Excel con un foglio per corso: intestazione «Nominativo … I S O N D G F M A M G L»
  // (I = iscrizione, poi i mesi dell'esercizio da settembre). In ogni cella la data del pagamento
  // (gg/mm, eventualmente seguita dall'importo) e lo sfondo che indica il mezzo, come nella legenda
  // in fondo al foglio: verde POS/SumUp, giallo banca, senza colore contanti.
  const REG_LEGENDA = { POS: 'sumup', SUMUP: 'sumup', CARTA: 'sumup', BANCA: 'banca', BONIFICO: 'banca', CASH: 'contanti', CONTANTI: 'contanti', PAYPAL: 'paypal', SATISPAY: 'satispay' };
  const REG_COLORI = { FF92D050: 'sumup', FFFFFF00: 'banca', FFFFC000: 'paypal', FF00B0F0: 'satispay' };
  const REG_MEZZI = { contanti: 'Contanti', sumup: 'SumUp (carta)', banca: 'Bonifico', paypal: 'PayPal', satispay: 'Satispay' };
  const INIZIALI_MESI = ['G', 'F', 'M', 'A', 'M', 'G', 'L', 'A', 'S', 'O', 'N', 'D'];
  const mezzoScrittura = (m) => (m === 'contanti' ? 'contanti' : m === 'sumup' ? 'sumup' : m ? 'banca' : null);
  const pad2 = (x) => String(x).padStart(2, '0');
  const isoUTC = (d) => d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());

  function coloreCella(cell) {
    const f = cell && cell.fill;
    if (!f || f.type !== 'pattern' || !f.pattern || f.pattern === 'none') return null;
    const c = f.fgColor || {};
    if (c.argb) { const a = String(c.argb).toUpperCase(); return /^(FF|00)FFFFFF$/.test(a) ? null : a; }
    if (c.theme !== undefined) { const t = Math.round((c.tint || 0) * 100) / 100; return c.theme === 0 && !t ? null : 'T' + c.theme + (t ? ':' + t : ''); }
    if (c.indexed !== undefined) return c.indexed === 64 || c.indexed === 9 ? null : 'I' + c.indexed;
    return null;
  }
  function valoreCella(cell) {
    let v = cell ? cell.value : null;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if (Array.isArray(v.richText)) v = v.richText.map((t) => t.text).join('');
      else if ('result' in v) v = v.result;
      else if (typeof v.text === 'string') v = v.text;
      else v = null;
    }
    return v;
  }
  // rosso: FF0000, C00000 e tonalità vicine
  function rosso(k) {
    if (!k || !/^[0-9A-F]{8}$/.test(k)) return false;
    const r = parseInt(k.slice(2, 4), 16), g = parseInt(k.slice(4, 6), 16), b = parseInt(k.slice(6, 8), 16);
    return r >= 0xB0 && g <= 0x60 && b <= 0x60;
  }
  // grigio: mesi (o iscrizione) che non verranno pagati. Bianco scurito, nero schiarito o un grigio neutro
  function grigio(k) {
    if (!k) return false;
    const m = /^T(\d+)(?::(-?[\d.]+))?$/.exec(k);
    if (m) { const th = Number(m[1]), t = Number(m[2] || 0); return (th === 0 && t < 0) || (th === 1 && t > 0) || (th === 2 && t <= 0); }
    if (/^I(22|23|55)$/.test(k)) return true;
    if (!/^[0-9A-F]{8}$/.test(k)) return false;
    const r = parseInt(k.slice(2, 4), 16), g = parseInt(k.slice(4, 6), 16), b = parseInt(k.slice(6, 8), 16);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn <= 0x14 && mx >= 0x40 && mx <= 0xF2;
  }
  const testoCella = (cell) => { const v = valoreCella(cell); return v instanceof Date || v == null ? '' : clean(String(v)); };

  // gg/mm senza anno: l'anno è quello che avvicina di più la data al mese della colonna,
  // evitando date future e lontane dall'esercizio
  function dataGiornoMese(g, m, y, rifYM, s, oggi) {
    if (!(g >= 1 && g <= 31 && m >= 1 && m <= 12)) return null;
    const mk = (yy) => { const t = Date.UTC(yy, m - 1, g); const d = new Date(t); return d.getUTCMonth() === m - 1 ? { t, iso: isoUTC(d) } : null; };
    if (y) { const x = mk(y < 100 ? 2000 + y : y); return x ? x.iso : null; }
    const y0 = Number(rifYM.slice(0, 4));
    const rif = Date.UTC(y0, Number(rifYM.slice(5, 7)) - 1, 15);
    const limite = addMonths(s.inizio.slice(0, 7), -3) + '-01';
    let best = null;
    [y0 - 1, y0, y0 + 1].forEach((yy) => {
      const x = mk(yy);
      if (!x) return;
      let dist = Math.abs(x.t - rif);
      if (x.iso < limite || x.iso > s.fine) dist += 1e12;
      if (oggi && x.iso > oggi) dist += 1e13;
      if (!best || dist < best.dist) best = { iso: x.iso, dist };
    });
    return best ? best.iso : null;
  }
  const RX_REG_DATA = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}|\d{2}))?(?:\s*(?:[-–:=]\s*)?(?:€\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)?)?$/i;
  const RX_REG_IMP = /^(?:€\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)?$/i;
  function leggiCellaPagamento(v, rifYM, s, oggi) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return { testo: fmtData(isoUTC(v)), data: isoUTC(v), importo: null, problema: null };
    if (typeof v === 'number') return { testo: String(v).replace('.', ','), data: null, importo: r2(v), problema: 'senzaData' };
    const t = clean(String(v));
    if (!t) return null;
    let m = RX_REG_DATA.exec(t);
    if (m) {
      const data = dataGiornoMese(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, rifYM, s, oggi);
      return { testo: t, data, importo: m[4] ? parseImporto(m[4]) : null, problema: data ? null : 'illeggibile' };
    }
    m = RX_REG_IMP.exec(t);
    if (m) return { testo: t, data: null, importo: parseImporto(m[1]), problema: 'senzaData' };
    return { testo: t, data: null, importo: null, problema: 'illeggibile' };
  }

  function leggiRegistro(wb, s, oggi) {
    const mesi = mesiEsercizio(s);
    const fogli = [], pagamenti = [], saltati = [], avvisi = [], righe = [];
    wb.eachSheet((ws) => {
      const maxR = ws.rowCount || 0, maxC = Math.max(ws.columnCount || 0, 1);
      let hr = 0, cNome = 0;
      for (let r = 1; r <= Math.min(10, maxR) && !hr; r++) {
        for (let c = 1; c <= maxC; c++) {
          if (/^(nominativ|cognome e nome|nome e cognome)/i.test(testoCella(ws.getCell(r, c)))) { hr = r; cNome = c; break; }
        }
      }
      if (!hr) { if (maxR) avvisi.push('Foglio «' + ws.name + '»: non trovo la colonna «Nominativo», il foglio non è stato letto.'); return; }
      let cI = 0;
      const colMesi = [];
      for (let c = cNome + 1; c <= maxC + 1; c++) {
        const t = testoCella(ws.getCell(hr, c)).toUpperCase();
        if (!cI) { if (t === 'I' || /^ISCRIZ/.test(t)) cI = c; continue; }
        if (/^[A-Z]$/.test(t) && colMesi.length < mesi.length) colMesi.push({ c, lettera: t, ym: mesi[colMesi.length] });
        else break;
      }
      if (!cI) { avvisi.push('Foglio «' + ws.name + '»: non trovo la colonna «I» dell’iscrizione, il foglio non è stato letto.'); return; }
      // certificato medico: colonne «cert.» e «data scad.» tra il nominativo e l'iscrizione
      let cCert = 0, cScad = 0;
      for (let c = cNome + 1; c < cI; c++) {
        const t = testoCella(ws.getCell(hr, c)).toLowerCase();
        if (!cScad && /scad/.test(t)) cScad = c; else if (!cCert && /^cert/.test(t)) cCert = c;
      }
      if (colMesi.some((x) => x.lettera !== INIZIALI_MESI[Number(x.ym.slice(5, 7)) - 1])) {
        avvisi.push('Foglio «' + ws.name + '»: le colonne dei mesi (' + colMesi.map((x) => x.lettera).join(' ') + ') non seguono i mesi dell’esercizio da ' + meseNome(mesi[0]) + ': le ho lette in ordine.');
      }
      // legenda dei colori (riga con POS, BANCA, CASH…)
      const legenda = {};
      const righeLegenda = new Set();
      for (let r = hr + 1; r <= maxR; r++) {
        let n = 0;
        for (let c = 1; c <= maxC; c++) {
          const cell = ws.getCell(r, c);
          const t = testoCella(cell).toUpperCase();
          if (REG_LEGENDA[t]) { n++; const k = coloreCella(cell); if (k) legenda[k] = REG_LEGENDA[t]; }
        }
        if (n >= 2) righeLegenda.add(r);
      }
      const colori = { ...REG_COLORI, ...legenda };
      const celle = [{ c: cI, voce: 'assoc', ym: null }].concat(colMesi.map((x) => ({ c: x.c, voce: 'mese', ym: x.ym })));
      let persone = 0;
      for (let r = hr + 1; r <= maxR; r++) {
        if (righeLegenda.has(r)) continue;
        const nome = testoCella(ws.getCell(r, cNome));
        let any = false;
        // celle grigie e vuote: iscrizione o mesi da non incassare
        const riga = { foglio: ws.name, riga: r, nomeReg: nome, assoc: false, mesi: [], cert: cCert ? testoCella(ws.getCell(r, cCert)) : '', scad: null };
        if (cScad) {
          const v = valoreCella(ws.getCell(r, cScad));
          if (v instanceof Date) riga.scad = isoUTC(v);
          else if (v) { const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(clean(String(v))); if (m) riga.scad = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(m[2]) + '-' + pad2(m[1]); }
        }
        celle.forEach((x) => {
          const cell = ws.getCell(r, x.c);
          const l = leggiCellaPagamento(valoreCella(cell), x.ym || s.inizio.slice(0, 7), s, oggi);
          if (!l) {
            const k = coloreCella(cell);
            if (grigio(k) && !colori[k]) { if (x.voce === 'assoc') riga.assoc = true; else riga.mesi.push(x.ym); }
            return;
          }
          any = true;
          const colore = coloreCella(cell);
          const mezzo = colore ? (colori[colore] || null) : 'contanti';
          const p = { id: ws.name + '!' + cell.address, foglio: ws.name, riga: r, cella: cell.address, nomeReg: nome, voce: x.voce, mese: x.ym, data: l.data, importo: l.importo, testo: l.testo, colore, mezzo, problemi: [] };
          if (l.problema) p.problemi.push(l.problema);
          if (!nome) p.problemi.push('senzaNome');
          if (p.data && (p.data < s.inizio || p.data > s.fine)) p.problemi.push('fuori');
          else if (p.data && oggi && p.data > oggi) p.problemi.push('futura');
          if (colore && !colori[colore]) p.problemi.push('colore');
          // regola: le celle evidenziate in rosso nei mesi (da S a L) non si registrano
          if (x.voce === 'mese' && rosso(colore)) { saltati.push(p); return; }
          pagamenti.push(p);
        });
        if (any && nome) persone++;
        if (nome) righe.push(riga);
      }
      fogli.push({ nome: ws.name, titolo: testoCella(ws.getCell(1, 1)) || ws.name, persone, mesi: colMesi.map((x) => x.lettera).join(''), ultimoMese: colMesi.length ? colMesi[colMesi.length - 1].ym : null, legenda });
    });
    // ultimo mese con una colonna nel registro (di solito luglio): oltre, nessuna cella può essere grigia
    const ultimoMese = fogli.reduce((m, f) => (f.ultimoMese && (!m || f.ultimoMese > m) ? f.ultimoMese : m), null);
    return { fogli, pagamenti, saltati, avvisi, righe, ultimoMese };
  }

  // Archivio dell'app «Registro pagamenti» (Foglio Google): tabelle corsi, soci, iscrizioni, pagamenti.
  // Diventa la stessa «lettura» del file Excel, così il confronto con il Libro Giornale è identico.
  function letturaDaArchivio(tab, s, oggi) {
    const t = tab || {};
    const vivi = (arr) => (Array.isArray(arr) ? arr : []).filter((r) => r && r.id && !(r.eliminato === true || r.eliminato === 'true'));
    const mesi = mesiEsercizio(s);
    const corsi = new Map(vivi(t.corsi).map((c) => [c.id, c]));
    const soci = new Map(vivi(t.soci).map((x) => [x.id, x]));
    const iscr = vivi(t.iscrizioni).filter((i) => i.esercizio === s.es && corsi.has(i.corso) && soci.has(i.socio));
    const pag = vivi(t.pagamenti).filter((p) => p.esercizio === s.es);
    const avvisi = [];
    const usati = new Set(iscr.map((i) => i.corso).concat(pag.map((p) => p.corso)));
    const fogli = Array.from(corsi.values()).filter((c) => usati.has(c.id))
      .sort((a, b) => num(a.ordine) - num(b.ordine) || String(a.nome).localeCompare(String(b.nome), 'it'))
      .map((c) => {
        const n = Math.max(1, Math.min(12, String(c.mesi || '').length || 11));
        return { nome: String(c.nome), titolo: c.titolo || String(c.nome), persone: 0, mesi: String(c.mesi || ''), ultimoMese: mesi[n - 1] || null, legenda: {}, quota: isNum(c.quota) ? Number(c.quota) : null };
      });
    const nomeProposto = (so) => {
      if (!so || !so.cognome) return null;
      const ini = clean(so.nome || '').split(' ').filter(Boolean).map((w) => normNome(w).charAt(0).toUpperCase() + '.').join('');
      return clean(maiuscola(so.cognome) + (ini ? ' ' + ini : ''));
    };
    const righe = iscr.map((i, k) => {
      const nd = String(i.nonDovuti || '').split(',').map((x) => x.trim()).filter(Boolean);
      const so = soci.get(i.socio);
      return { foglio: String(corsi.get(i.corso).nome), riga: k + 1, nomeReg: clean(so.nominativo), assoc: nd.includes('I'), mesi: nd.filter((x) => /^\d{4}-\d{2}$/.test(x)), cert: so.certificato === true || so.certificato === 'true' ? 'X' : '', scad: so.scadenzaCert || null };
    });
    const persone = new Map();
    const pagamenti = [];
    pag.forEach((p) => {
      const so = soci.get(p.socio), c = corsi.get(p.corso);
      if (!so || !c) { avvisi.push('Un pagamento del ' + fmtData(p.data) + (p.nominativo ? ' di ' + p.nominativo : '') + ' riguarda un socio o un corso che non c’è più nell’archivio: non è stato letto.'); return; }
      const voce = p.voce === 'iscrizione' ? 'assoc' : 'mese';
      const importo = isNum(p.importo) ? r2(Number(p.importo)) : null;
      const it = {
        id: 'online:' + p.id, foglio: String(c.nome), riga: 0, cella: voce === 'assoc' ? 'iscrizione' : (p.mese ? meseNome(p.mese) : '?'),
        nomeReg: clean(so.nominativo), nomeProposto: nomeProposto(so), voce, mese: voce === 'mese' ? p.mese : null,
        data: p.data || null, importo, testo: (p.data ? fmtData(p.data).slice(0, 5) : '') + (importo !== null ? ' ' + fmt(importo) : ''),
        colore: null, mezzo: REG_MEZZI[p.mezzo] ? p.mezzo : 'contanti', problemi: [], versamento: p.versamento || null, dispositivo: p.dispositivo || null
      };
      if (!it.data) it.problemi.push('senzaData');
      else if (it.data < s.inizio || it.data > s.fine) it.problemi.push('fuori');
      else if (oggi && it.data > oggi) it.problemi.push('futura');
      if (voce === 'mese' && (!p.mese || !mesi.includes(p.mese))) it.problemi.push('illeggibile');
      pagamenti.push(it);
      if (!persone.has(c.nome)) persone.set(c.nome, new Set());
      persone.get(c.nome).add(normNome(so.nominativo));
    });
    fogli.forEach((f) => { f.persone = persone.has(f.nome) ? persone.get(f.nome).size : 0; });
    const ultimoMese = fogli.reduce((m, f) => (f.ultimoMese && (!m || f.ultimoMese > m) ? f.ultimoMese : m), null);
    return { fogli, pagamenti, saltati: [], avvisi, righe, ultimoMese, origine: 'online' };
  }

  // ---- nomi: nel registro «NOME COGNOME» per esteso, nel Libro Giornale «Cognome N.»
  const SEGNAPOSTO = /^(x{2,}|\?+|nn)$/i;
  const PARTICELLE = new Set(['di', 'de', 'da', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'dal', 'dalla', 'la', 'lo', 'le', 'li', 'van', 'von', 'el', 'al', 'mac', 'mc', 'san', 'santa', 'dos', 'das', 'du']);
  function normNome(n) {
    return clean(String(n == null ? '' : n).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`´]/g, '').replace(/[-_,;]/g, ' ')).toLowerCase();
  }
  function parseNome(n) {
    const parole = [], iniziali = [];
    normNome(n).split(' ').filter(Boolean).forEach((t) => {
      if (/^([a-z]\.)+[a-z]?$/.test(t) || /^[a-z]$/.test(t)) t.replace(/\./g, '').split('').forEach((ch) => iniziali.push(ch));
      else if (t.replace(/\./g, '')) parole.push(t.replace(/\./g, ''));
    });
    const jolly = parole.length > 0 && parole.every((w) => SEGNAPOSTO.test(w));
    return { parole: jolly ? [] : parole, iniziali, jolly };
  }
  // quanto il nome del registro R corrisponde al nome J del Libro Giornale (0 = per niente)
  function punteggioNome(R, J) {
    const resto = R.parole.slice();
    for (const w of J.parole) { const i = resto.indexOf(w); if (i < 0) return 0; resto.splice(i, 1); }
    const ini = resto.map((w) => w[0]).concat(R.iniziali);
    if (!J.iniziali.length) return J.jolly || ini.length ? 0 : 100;
    if (!ini.length) return 0;
    const a = ini.join(''), b = J.iniziali.join('');
    if (a === b) return J.jolly ? 70 : 90;
    if (J.jolly) return 0;
    return a.startsWith(b) || b.startsWith(a) ? 60 : 0;
  }
  const maiuscola = (w) => String(w).toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());
  function proponiNome(nomeReg, usati) {
    const toks = clean(nomeReg).split(' ').filter(Boolean);
    if (toks.length < 2) return { nome: maiuscola(toks[0] || ''), incompleto: true };
    let k = toks.length - 1;
    while (k > 1 && PARTICELLE.has(normNome(toks[k - 1]))) k--;
    const cognome = toks.slice(k).map(maiuscola).join(' ');
    const nomi = toks.slice(0, k);
    let nome = cognome + ' ' + nomi.map((w) => normNome(w).charAt(0).toUpperCase() + '.').join('');
    if (usati && usati.has(chiaveSocio(nome))) nome = cognome + ' ' + maiuscola(nomi[0]);
    return { nome, incompleto: false };
  }
  // cognome di famiglia: serve a riunire in una sola operazione fratelli pagati insieme
  function famiglia(nome) {
    const P = parseNome(nome);
    if (P.jolly || !P.parole.length) return '?' + normNome(nome); // cognome ancora da sapere: ognuno per sé
    return P.iniziali.length || P.parole.length < 2 ? P.parole.join(' ') : P.parole.slice(0, -1).join(' ');
  }
  function mezzoOp(op, s) {
    const cassa = contoFin(s, 'cassa').n;
    if (op.righe.some((r) => /sumup/i.test(r.desc || ''))) return 'sumup';
    return op.righe.some((r) => r.conto === cassa) ? 'contanti' : 'banca';
  }
  // quote già registrate nel Libro Giornale, per socio
  function indiceQuote(sortedOps, s) {
    const soci = new Map(), refs = new Map();
    const get = (nome) => {
      const k = chiaveSocio(nome);
      if (!soci.has(k)) soci.set(k, { nome: clean(nome), key: k, parsed: parseNome(nome), assoc: [], mesi: new Map(), voci: [], qm: null, tipo: null });
      return soci.get(k);
    };
    sortedOps.forEach((op) => {
      if (op.tipo === 'apertura') return;
      const mz = mezzoOp(op, s);
      (op.reg || []).forEach((x) => refs.set(x, op));
      const partOp = new Map();
      op.righe.forEach((r) => {
        const d = clean(r.desc);
        const imp = r2(num(r.avere) - num(r.dare));
        let m = RX_ASSOC.exec(d);
        if (m) { const so = get(m[1]); const v = { op, n: op._n, data: op.data, mezzo: mz, importo: imp, desc: d, voci: ['assoc'] }; so.assoc.push(v); so.voci.push(v); return; }
        m = RX_PART.exec(d) || RX_PART_NOMESE.exec(d);
        if (m) {
          const so = get(m[2]);
          const mesi = m[3] ? parsePeriodo(m[3]) : [];
          const v = { op, n: op._n, data: op.data, mezzo: mz, importo: imp, desc: d, mesi, voci: mesi.slice(), perMese: mesi.length ? r2(imp / mesi.length) : null };
          mesi.forEach((ym) => { if (!so.mesi.has(ym)) so.mesi.set(ym, []); so.mesi.get(ym).push(v); });
          if (v.perMese) so.qm = v.perMese;
          so.tipo = /corsi/i.test(m[1]) ? 'corsi' : 'att';
          so.voci.push(v);
          partOp.set(so.key, v);
        }
      });
      mesiForzatiOp(op).forEach((f) => {
        const so = get(f.socio);
        let v = partOp.get(so.key);
        if (v) {
          v.mesi = Array.from(new Set(v.mesi.concat(f.mesi))).sort();
          v.voci = v.mesi.slice();
          v.perMese = r2(v.importo / v.mesi.length);
          so.qm = v.perMese;
        } else {
          v = { op, n: op._n, data: op.data, mezzo: mz, importo: null, desc: op.descCassa || '', mesi: f.mesi.slice(), voci: f.mesi.slice(), perMese: null };
          so.voci.push(v);
        }
        v.forzato = true;
        f.mesi.forEach((ym) => { if (!so.mesi.has(ym)) so.mesi.set(ym, []); if (!so.mesi.get(ym).includes(v)) so.mesi.get(ym).push(v); });
      });
    });
    return { soci, refs };
  }

  // Confronta il registro con il Libro Giornale.
  // opz: { alias:{nomeNormalizzato: nome in contabilità}, quote:{foglio: €/mese}, importi:{idCella: €}, mezzi:{idCella: mezzo},
  //        scelte:{idProposta: true|false}, ricevute: bool, ricDa: n }
  // abbinamenti e quote memorizzati nelle impostazioni come elenchi (i nomi possono contenere spazi e punti)
  function registroSalvato(s) {
    const r = (s && s.registro) || {};
    const alias = {}, quote = {};
    (Array.isArray(r.abbinamenti) ? r.abbinamenti : []).forEach((x) => { if (x && x.r && x.n) alias[x.r] = x.n; });
    (Array.isArray(r.quote) ? r.quote : []).forEach((x) => { if (x && x.f && isNum(x.q)) quote[x.f] = Number(x.q); });
    // pagamenti del registro che l'utente ha segnato come già in contabilità: «nome|voce|foglio»
    const saltati = (Array.isArray(r.saltati) ? r.saltati : []).filter((x) => typeof x === 'string' && x);
    return { alias, quote, saltati };
  }
  // mesi da non incassare:
  //  - dalle celle grigie dell'ultimo registro caricato: registro.nonIncassare = {file, aggiornato, fino, soci:[{n, m:[ym], i, f}]}
  //  - segnati a mano in «Situazione soci»: registro.nonIncassareManuale = [{n, m:[ym]}] (restano anche ricaricando il registro)
  function nonIncassareSalvati(s) {
    const reg = (s && s.registro) || {};
    const x = reg.nonIncassare;
    const map = new Map();
    const get = (n) => {
      const k = chiaveSocio(n);
      if (!map.has(k)) map.set(k, { nome: clean(n), mesi: new Set(), grigi: new Set(), manuali: new Set(), assoc: false, fino: null });
      return map.get(k);
    };
    (x && Array.isArray(x.soci) ? x.soci : []).forEach((y) => {
      if (!y || !y.n) return;
      const e = get(y.n);
      (Array.isArray(y.m) ? y.m : []).forEach((ym) => { e.mesi.add(ym); e.grigi.add(ym); });
      if (y.i) e.assoc = true;
      if (typeof y.f === 'string') e.fino = y.f;
    });
    (Array.isArray(reg.nonIncassareManuale) ? reg.nonIncassareManuale : []).forEach((y) => {
      if (!y || !y.n) return;
      const e = get(y.n);
      (Array.isArray(y.m) ? y.m : []).forEach((ym) => { e.mesi.add(ym); e.manuali.add(ym); });
    });
    return map;
  }
  const NI_VUOTO = { mesi: new Set(), grigi: new Set(), manuali: new Set(), assoc: false, fino: null };
  const niCache = new WeakMap();
  function nonIncassareSocio(s, nome) {
    const src = s && s.registro;
    if (!src || typeof src !== 'object' || !nome || (!src.nonIncassare && !src.nonIncassareManuale)) return NI_VUOTO;
    if (!niCache.has(src)) niCache.set(src, nonIncassareSalvati(s));
    return niCache.get(src).get(chiaveSocio(nome)) || NI_VUOTO;
  }
  function registroDaSalvare(alias, quote, saltati) {
    return {
      abbinamenti: Object.keys(alias).filter((k) => alias[k]).sort().map((k) => ({ r: k, n: alias[k] })),
      quote: Object.keys(quote).filter((k) => isNum(quote[k])).sort().map((k) => ({ f: k, q: Number(quote[k]) })),
      saltati: Array.from(new Set(saltati || [])).sort()
    };
  }
  // chiave stabile di un pagamento del registro (non dipende dalla riga, che può cambiare)
  const chiaveBase = (p) => normNome(p.nomeReg) + '|' + (p.voce === 'assoc' ? 'assoc' : p.mese) + '|' + p.foglio;
  // comprende anche il contenuto della cella: se nel registro si scrive un'altra data il pagamento torna a essere proposto
  const chiavePagamento = (p) => chiaveBase(p) + '|' + (p.data || ('t:' + normNome(p.testo)));
  function confrontaRegistro(lettura, s, sortedOps, opz) {
    const o = opz || {};
    const salvato = registroSalvato(s);
    const alias = { ...salvato.alias, ...(o.alias || {}) };
    const par = s.par || {};
    const { soci, refs } = indiceQuote(sortedOps, s);
    const sociList = Array.from(soci.values());

    // 1. persone del registro e loro nome in contabilità
    const persone = new Map();
    lettura.pagamenti.forEach((p) => {
      if (!p.nomeReg) return;
      const k = normNome(p.nomeReg);
      if (!persone.has(k)) persone.set(k, { key: k, nomeReg: p.nomeReg, fogli: new Set(), pagamenti: [] });
      const x = persone.get(k);
      if (p.nomeProposto && !x.nomeProposto) x.nomeProposto = p.nomeProposto; // dall'app: cognome e nome separati
      x.fogli.add(p.foglio); x.pagamenti.push(p);
    });
    const usati = new Set(soci.keys());
    persone.forEach((x) => {
      const R = parseNome(x.nomeReg);
      if (alias[x.key]) {
        x.nome = clean(alias[x.key]);
        x.stato = soci.has(chiaveSocio(x.nome)) ? 'scelto' : 'nuovo';
        x.daAlias = true;
      } else {
        let best = [], top = 0;
        sociList.forEach((so) => {
          const sc = punteggioNome(R, so.parsed);
          if (sc > top) { top = sc; best = [so]; } else if (sc && sc === top) best.push(so);
        });
        if (best.length === 1) { x.nome = best[0].nome; x.stato = top >= 90 ? 'trovato' : 'probabile'; }
        else if (best.length > 1) { x.nome = ''; x.stato = 'ambiguo'; x.candidati = best.map((b) => b.nome); }
        else if (x.nomeProposto) { x.nome = x.nomeProposto; x.stato = soci.has(chiaveSocio(x.nome)) ? 'probabile' : 'nuovo'; }
        else { const pr = proponiNome(x.nomeReg, usati); x.nome = pr.nome; x.stato = pr.incompleto ? 'incompleto' : 'nuovo'; }
      }
      if (x.nome) usati.add(chiaveSocio(x.nome));
    });

    // 2. quota mensile di ciascun corso: la più frequente tra i soci del solo quel corso
    const quoteCorsi = {};
    lettura.fogli.forEach((f) => {
      const cnt = new Map();
      persone.forEach((x) => {
        if (x.fogli.size !== 1 || !x.fogli.has(f.nome) || !x.nome) return;
        const so = soci.get(chiaveSocio(x.nome));
        if (so && so.qm) cnt.set(so.qm, (cnt.get(so.qm) || 0) + 1);
      });
      let mode = null, mc = 0;
      cnt.forEach((n, v) => { if (n > mc || (n === mc && v === num(par.quotaMese))) { mode = v; mc = n; } });
      const salvata = salvato.quote[f.nome];
      const scelta = o.quote && isNum(o.quote[f.nome]) ? Number(o.quote[f.nome]) : null;
      quoteCorsi[f.nome] = scelta !== null ? { valore: scelta, fonte: 'scelta' }
        : isNum(salvata) ? { valore: Number(salvata), fonte: 'salvata' }
          : isNum(f.quota) ? { valore: Number(f.quota), fonte: 'app' }
          : mode !== null ? { valore: mode, fonte: 'storico', n: mc } : { valore: num(par.quotaMese), fonte: 'predefinita' };
    });

    // 3. ogni pagamento: già in contabilità, da registrare o da verificare
    const presenti = [], verificare = [], doppi = [], nuovi = [], saltatiDaTe = [];
    const daSaltare = new Set(salvato.saltati);
    const visti = new Map();
    const reclamate = new Set();
    // corsi di ciascuna persona (righe del registro, anche senza pagamenti)
    const corsiPersona = new Map();
    (lettura.righe || []).concat(lettura.pagamenti).forEach((r) => {
      if (!r.nomeReg) return;
      const k = normNome(r.nomeReg);
      if (!corsiPersona.has(k)) corsiPersona.set(k, new Set());
      corsiPersona.get(k).add(r.foglio);
    });
    const piuCorsi = (pers) => !!pers && (corsiPersona.get(pers.key) || pers.fogli).size > 1;
    // quota del mese di una cella: importo scritto nel registro o quota del corso
    const quotaCella = (it) => (o.importi && isNum(o.importi[it.id]) ? r2(o.importi[it.id]) : isNum(it.importo) ? it.importo : num((quoteCorsi[it.foglio] || {}).valore));
    // mesi di chi frequenta più corsi: si confrontano gli importi, non solo i mesi (vedi sotto)
    const differiti = new Map();
    const nonTrovato = (it, p, p0, pers) => {
      const kS = daSaltare.has(it.chiave) ? it.chiave : daSaltare.has(chiaveBase(p0)) ? chiaveBase(p0) : null;
      if (kS) { it.chiaveSalvata = kS; saltatiDaTe.push(it); return; }
      const motivi = p.problemi.filter((x) => !(x === 'colore' && it.mezzo));
      if (pers && pers.stato === 'ambiguo') motivi.push('ambiguo');
      if (pers && pers.stato === 'incompleto') motivi.push('incompleto');
      if (motivi.length) { verificare.push({ ...it, motivi }); return; }
      nuovi.push(it);
    };
    lettura.pagamenti.forEach((p0) => {
      let p = p0;
      // data corretta a mano (cella senza data o con una data non valida)
      if (o.date && o.date[p0.id]) {
        const d = o.date[p0.id];
        const pr = p0.problemi.filter((x) => !['senzaData', 'illeggibile', 'fuori', 'futura'].includes(x));
        if (d < s.inizio || d > s.fine) pr.push('fuori');
        p = { ...p0, data: d, problemi: pr, dataCorretta: true };
      }
      const pers = p.nomeReg ? persone.get(normNome(p.nomeReg)) : null;
      const it = { ...p, persona: pers, nome: pers ? pers.nome : '', mezzo: (o.mezzi && o.mezzi[p.id]) || p.mezzo };
      const voceKey = p.voce === 'assoc' ? 'assoc' : p.mese;
      it.voceKey = voceKey;
      it.chiave = chiavePagamento(p0);
      if (pers && pers.nome && pers.stato !== 'ambiguo' && pers.stato !== 'incompleto') {
        const sk = chiaveSocio(pers.nome);
        it.ref = pers.key + '|' + voceKey + '|' + p.foglio;
        const dk = p.voce === 'assoc' ? sk + '|assoc' : sk + '|' + p.mese + '|' + p.foglio;
        if (visti.has(dk)) { doppi.push({ ...it, di: visti.get(dk) }); return; }
        visti.set(dk, p.id);
        const so = soci.get(sk);
        if (p.voce === 'mese' && piuCorsi(pers)) {
          if (!differiti.has(sk)) differiti.set(sk, { so, celle: [] });
          differiti.get(sk).celle.push({ it, p, p0, pers });
          return;
        }
        let match = null;
        if (refs.has(it.ref)) { const op = refs.get(it.ref); match = { op, n: op._n, data: op.data, mezzo: mezzoOp(op, s), importo: null, perMese: null, desc: op.descCassa || '', collegato: op.fonte !== 'registro' }; }
        else if (so && p.voce === 'assoc' && so.assoc.length) match = so.assoc[0];
        else if (so && p.voce === 'mese' && so.mesi.has(p.mese)) match = so.mesi.get(p.mese)[0];
        if (match) {
          reclamate.add(match.op.id + '|' + sk + '|' + voceKey);
          const diff = [];
          if (p.data && match.data && p.data !== match.data) diff.push('data');
          if (it.mezzo && mezzoScrittura(it.mezzo) !== match.mezzo) diff.push('mezzo');
          const atteso = p.voce === 'assoc' ? match.importo : match.perMese;
          if (isNum(p.importo) && isNum(atteso) && Math.abs(atteso - p.importo) > 0.004) diff.push('importo');
          presenti.push({ ...it, match, diff });
          return;
        }
      }
      nonTrovato(it, p, p0, pers);
    });

    // 3b. chi frequenta più corsi (es. kung fu e basket, 25 € ciascuno): nel Libro Giornale il mese è una riga sola
    //     con la somma delle quote pagate. Ogni cella del registro «consuma» la sua quota dall'importo registrato
    //     per quel mese; se l'importo è già esaurito (pagata solo la quota di un corso) la cella va registrata.
    const giorni = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 864e5 : 1e6);
    differiti.forEach(({ so, celle }, sk) => {
      const voci = so ? so.voci.filter((v) => v.mesi && v.mesi.length) : [];
      const residuo = new Map(voci.map((v) => [v, v.forzato && !isNum(v.importo) ? Infinity : num(v.importo)]));
      celle.forEach((c) => { c.imp = quotaCella(c.it); c.legata = refs.has(c.it.ref); });
      celle.sort((a, b) => (b.legata - a.legata) || ((a.p.data || '9') < (b.p.data || '9') ? -1 : (a.p.data || '9') > (b.p.data || '9') ? 1 : 0) || a.p.foglio.localeCompare(b.p.foglio));
      celle.forEach(({ it, p, p0, pers, imp, legata }) => {
        const m = p.mese;
        let v = null;
        if (legata) {
          const op = refs.get(it.ref);
          v = voci.find((x) => x.op === op && x.mesi.includes(m)) || null;
          if (!v) {
            presenti.push({ ...it, match: { op, n: op._n, data: op.data, mezzo: mezzoOp(op, s), importo: null, perMese: null, desc: op.descCassa || '', collegato: op.fonte !== 'registro' }, diff: [] });
            reclamate.add(op.id + '|' + sk + '|' + m);
            return;
          }
        } else {
          const cand = voci.filter((x) => x.mesi.includes(m) && residuo.get(x) > 0.004)
            .sort((a, b) => ((a.data === p.data) ? 0 : 1) - ((b.data === p.data) ? 0 : 1) || giorni(a.data, p.data) - giorni(b.data, p.data) || num(a.op.ord) - num(b.op.ord));
          v = cand.find((x) => residuo.get(x) >= imp - 0.004) || cand[0] || null;
        }
        if (!v) { nonTrovato(it, p, p0, pers); return; }
        const res = residuo.get(v);
        const quota = r2(Math.min(imp, res));
        residuo.set(v, res - quota);
        reclamate.add(v.op.id + '|' + sk + '|' + m);
        const diff = [];
        if (p.data && v.data && p.data !== v.data) diff.push('data');
        if (it.mezzo && mezzoScrittura(it.mezzo) !== v.mezzo) diff.push('mezzo');
        if (res !== Infinity && quota < imp - 0.004) diff.push('importo');
        presenti.push({ ...it, match: { ...v, perMese: res === Infinity ? null : quota, collegato: legata && v.op.fonte !== 'registro' }, diff });
      });
    });

    // 4. importi
    nuovi.forEach((it) => {
      const so = soci.get(chiaveSocio(it.nome));
      if (o.importi && isNum(o.importi[it.id])) { it.imp = r2(o.importi[it.id]); it.fonteImp = 'modificato'; }
      else if (isNum(it.importo)) { it.imp = it.importo; it.fonteImp = 'registro'; }
      else if (it.voce === 'assoc') { it.imp = num(par.quotaAssoc); it.fonteImp = 'quota associativa'; }
      else if (so && so.qm && !piuCorsi(it.persona)) { it.imp = so.qm; it.fonteImp = 'ultima quota'; }
      else { it.imp = quoteCorsi[it.foglio].valore; it.fonteImp = 'quota del corso'; }
      it.tipoPart = (so && so.tipo) || 'att';
    });

    // 5. una scrittura per data, mezzo e famiglia
    const gruppi = new Map();
    nuovi.slice().sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).forEach((it) => {
      const mz = mezzoScrittura(it.mezzo), fam = famiglia(it.nome);
      const k = it.data + '|' + mz + '|' + fam;
      if (!gruppi.has(k)) gruppi.set(k, { id: k, data: it.data, mezzo: mz, famiglia: fam, voci: [] });
      gruppi.get(k).voci.push(it);
    });
    const inRegistro = new Set();
    persone.forEach((x) => { if (x.nome) inRegistro.add(chiaveSocio(x.nome)); });
    const proposte = [];
    gruppi.forEach((g) => {
      const note = [], sospetti = [];
      const mezziReg = Array.from(new Set(g.voci.map((it) => it.mezzo)));
      if (mezziReg.includes('satispay')) note.push('Pagato con Satispay: registrato sul conto banca, senza commissione. Correggi l’importo se Satispay ha trattenuto una commissione.');
      if (mezziReg.includes('paypal')) note.push('Pagato con PayPal: registrato sul conto banca.');
      const totLinee = new Set(g.voci.map((it) => it.imp));
      soci.forEach((so) => {
        so.voci.forEach((v) => {
          if (v.data !== g.data || v.mezzo !== g.mezzo) return;
          const libere = v.voci.filter((vk) => !reclamate.has(v.op.id + '|' + so.key + '|' + vk));
          if (!libere.length) return;
          const forte = famiglia(so.nome) === g.famiglia;
          if (forte || (!inRegistro.has(so.key) && totLinee.has(v.importo))) sospetti.push({ forte, n: v.op._n, op: v.op.id, desc: v.desc, importo: v.importo, mezzo: v.mezzo });
        });
      });
      const voci = g.voci;
      proposte.push({
        id: g.id, data: g.data, mezzo: g.mezzo, mezziReg, famiglia: g.famiglia, voci, note, sospetti,
        reg: voci.map((it) => it.ref),
        incluso: o.scelte && g.id in o.scelte ? !!o.scelte[g.id] : !sospetti.some((x) => x.forte)
      });
    });

    // 6. scritture (le ricevute vanno numerate solo sulle proposte incluse, in ordine di data)
    let ric = isNum(o.ricDa) ? Number(o.ricDa) : null;
    proposte.forEach((pr) => {
      const perSocio = new Map();
      pr.voci.forEach((it) => {
        const k = chiaveSocio(it.nome);
        if (!perSocio.has(k)) perSocio.set(k, { nome: it.nome, assoc: null, mesi: new Map(), tipo: it.tipoPart });
        const x = perSocio.get(k);
        if (it.voce === 'assoc') x.assoc = it;
        else x.mesi.set(it.mese, r2((x.mesi.get(it.mese) || 0) + it.imp));
      });
      const sociF = [];
      perSocio.forEach((x) => {
        const runs = [];
        Array.from(x.mesi.keys()).sort().forEach((ym) => {
          const last = runs[runs.length - 1];
          if (last && addMonths(last.a, 1) === ym) { last.a = ym; last.imp = r2(last.imp + x.mesi.get(ym)); } else runs.push({ da: ym, a: ym, imp: x.mesi.get(ym) });
        });
        const r0 = o.ricevute && pr.incluso && ric !== null ? ric++ : null;
        if (!runs.length) sociF.push({ nome: x.nome, assoc: true, impAssoc: x.assoc.imp, part: false, ric: r0 });
        runs.forEach((ru, i) => sociF.push({ nome: x.nome, assoc: i === 0 && !!x.assoc, impAssoc: x.assoc ? x.assoc.imp : 0, part: true, tipoPart: x.tipo, da: ru.da, a: ru.a, impPart: ru.imp, ric: i === 0 ? r0 : null }));
      });
      pr.soci = sociF;
      pr.scrittura = scritturaQuote({ mezzo: pr.mezzo, commissione: null, soci: sociF }, { ...s, par: { ...par, ricevute: !!o.ricevute } });
      pr.totale = pr.scrittura.totale;
    });

    // 4. da non incassare (celle grigie): un mese non è dovuto se è grigio in tutte le righe della persona
    //    (chi frequenta due corsi può dover pagare il mese per l'altro); l'iscrizione, che si paga una volta,
    //    se è grigia in almeno una riga
    const ni = new Map();
    const altri = new Map(); // persone del registro senza pagamenti: contano solo se sono già in contabilità
    const personaRiga = (nomeReg) => {
      const k = normNome(nomeReg);
      if (persone.has(k)) return persone.get(k);
      if (!altri.has(k)) {
        let nome = alias[k] ? clean(alias[k]) : '';
        if (!nome) {
          const R = parseNome(nomeReg);
          let best = [], top = 0;
          sociList.forEach((so) => { const sc = punteggioNome(R, so.parsed); if (sc > top) { top = sc; best = [so]; } else if (sc && sc === top) best.push(so); });
          if (best.length === 1 && top >= 90) nome = best[0].nome;
        }
        altri.set(k, nome && soci.has(chiaveSocio(nome)) ? { key: k, nomeReg: clean(nomeReg), nome, stato: 'trovato' } : null);
      }
      return altri.get(k);
    };
    (lettura.righe || []).forEach((rg) => {
      const x = personaRiga(rg.nomeReg);
      if (!x || !x.nome || x.stato === 'ambiguo' || x.stato === 'incompleto') return;
      const k = chiaveSocio(x.nome);
      if (!ni.has(k)) ni.set(k, { n: x.nome, m: null, i: false, f: null, nomeReg: new Set(), celle: [] });
      const y = ni.get(k);
      y.nomeReg.add(x.nomeReg);
      const fo = lettura.fogli.find((z) => z.nome === rg.foglio);
      if (fo && fo.ultimoMese && (!y.f || fo.ultimoMese > y.f)) y.f = fo.ultimoMese; // ultimo mese dei suoi corsi
      y.m = y.m === null ? new Set(rg.mesi) : new Set(rg.mesi.filter((ym) => y.m.has(ym)));
      if (rg.assoc) y.i = true;
      if (rg.assoc || rg.mesi.length) y.celle.push(rg.foglio);
    });
    const nonIncassare = Array.from(ni.values()).map((y) => ({ n: y.n, m: Array.from(y.m || []).sort(), i: y.i, f: y.f, nomeReg: Array.from(y.nomeReg), fogli: Array.from(new Set(y.celle)) }))
      .filter((y) => y.m.length || y.i).sort((a, b) => a.n.localeCompare(b.n, 'it'));

    return {
      persone: Array.from(persone.values()), proposte, presenti, verificare, doppi, saltatiDaTe, quoteCorsi, nonIncassare,
      soci: sociList.map((x) => x.nome).sort((a, b) => a.localeCompare(b, 'it'))
    };
  }

  // ord delle nuove operazioni (in ordine di data): dopo l'ultima registrazione con data uguale o precedente,
  // oppure in fondo al Libro Giornale
  function ordiniInserimento(sortedOps, date, cronologico) {
    const maxOrd = sortedOps.reduce((m, x) => Math.max(m, num(x.ord)), 0);
    if (!cronologico) return date.map((d, i) => maxOrd + 1 + i);
    const ap = sortedOps.find((x) => x.tipo === 'apertura');
    const ops = sortedOps.filter((x) => x.tipo !== 'apertura');
    const pos = date.map((d) => { let k = -1; ops.forEach((x, i) => { if (x.data && x.data <= d) k = i; }); return k; });
    const out = [];
    let i = 0;
    while (i < date.length) {
      let j = i;
      while (j < date.length && pos[j] === pos[i]) j++;
      const k = pos[i];
      const lo = k >= 0 ? num(ops[k].ord) : (ap ? num(ap.ord) : 0);
      let hi = k + 1 < ops.length ? num(ops[k + 1].ord) : lo + (j - i) + 1;
      if (!(hi > lo)) hi = lo + 1;
      for (let t = i; t < j; t++) out.push(lo + (hi - lo) * (t - i + 1) / (j - i + 1));
      i = j;
    }
    return out;
  }

  // ---------------------------------------------------------------- ricevute
  // importo in lettere come nel foglio DATI: 75 -> "SETTANTACINQUE/00"
  function lettereIntero(n) {
    const U = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
    const D = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
    const sotto100 = (x) => {
      if (x < 20) return U[x];
      let d = D[Math.floor(x / 10)];
      const u = x % 10;
      if (u === 1 || u === 8) d = d.slice(0, -1);
      return d + (u === 3 ? 'tré' : U[u]);
    };
    const sotto1000 = (x) => {
      const c = Math.floor(x / 100), r = x % 100;
      let s = c === 0 ? '' : (c === 1 ? 'cento' : U[c] + 'cento');
      if (c && Math.floor(r / 10) === 8) s = s.slice(0, -1);
      return s + (r ? sotto100(r) : '');
    };
    if (!n) return 'zero';
    if (n >= 1e6) {
      const mil = Math.floor(n / 1e6), r = n % 1e6;
      return (mil === 1 ? 'unmilione' : lettereIntero(mil) + 'milioni') + (r ? lettereIntero(r) : '');
    }
    const mig = Math.floor(n / 1000), r = n % 1000;
    return (mig ? (mig === 1 ? 'mille' : sotto1000(mig) + 'mila') : '') + (r ? sotto1000(r) : '');
  }
  function numeroInLettere(v) {
    const c = Math.round(Math.abs(num(v)) * 100);
    return lettereIntero(Math.floor(c / 100)).toUpperCase() + '/' + String(c % 100).padStart(2, '0');
  }
  // come la macro: solo cifre, via lo 00 iniziale, prefisso 39 se manca
  function normalizzaTelefono(v, prefisso) {
    let c = String(v == null ? '' : v).replace(/\D/g, '');
    if (!c) return '';
    if (c.startsWith('00')) c = c.slice(2);
    if (c.length <= 11) c = String(prefisso || '39') + c;
    return c;
  }
  // dati dell'associazione e testi della ricevuta (dal foglio RICEVUTA della maschera Excel)
  function enteDefault() { return {}; }
  const esBreve = (s) => s.es.replace(/^(\d{4})-\d{2}(\d{2})$/, '$1-$2'); // 2026-2027 -> 2026-27
  const etichettaRicevuta = (n, s, ente) => String((ente && ente.formatoNumero) || '{n}/{aa}').replace('{n}', n).replace('{aa}', s.inizio.slice(2, 4)).replace('{aaaa}', s.inizio.slice(0, 4));
  const fineMese = (ym) => { const [y, m] = ym.split('-').map(Number); return ym + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate()); };

  // anagrafica: la riga che corrisponde al nome usato in contabilità
  function trovaAnagrafica(lista, nomeContabilita) {
    const k = chiaveSocio(nomeContabilita);
    const diretto = (lista || []).find((a) => a.contabilita && chiaveSocio(a.contabilita) === k);
    if (diretto) return { riga: diretto, certo: true };
    const J = parseNome(nomeContabilita);
    let best = [], top = 0;
    (lista || []).forEach((a) => {
      if (a.contabilita) return; // già collegata a un altro nome
      const sc = punteggioNome(parseNome(a.socio), J);
      if (sc > top) { top = sc; best = [a]; } else if (sc && sc === top) best.push(a);
    });
    if (best.length === 1) return { riga: best[0], certo: top >= 90 };
    return { riga: null, candidati: best };
  }

  // dati della ricevuta di un socio a partire dalla sua quota in un'operazione
  function ricevutaDaOperazione(op, nomeSocio, anag, ente, s) {
    const e = { ...enteDefault(), ...(ente || {}) };
    const k = chiaveSocio(nomeSocio);
    let importo = 0, assoc = false, part = false;
    const mesi = new Set();
    (op.righe || []).forEach((r) => {
      const d = clean(r.desc);
      let m = RX_ASSOC.exec(d);
      if (m && chiaveSocio(m[1]) === k) { importo += num(r.avere) - num(r.dare); assoc = true; return; }
      m = RX_PART.exec(d) || RX_PART_NOMESE.exec(d);
      if (m && chiaveSocio(m[2]) === k) {
        importo += num(r.avere) - num(r.dare); part = true;
        if (m[3]) parsePeriodo(m[3]).forEach((x) => mesi.add(x));
      }
    });
    mesiForzatiOp(op).forEach((f) => { if (chiaveSocio(f.socio) === k) f.mesi.forEach((x) => mesi.add(x)); });
    const ms = Array.from(mesi).sort();
    const tipo = assoc && part ? 'entrambe' : assoc ? 'assoc' : 'part';
    const a = anag || {};
    return {
      socio: clean(nomeSocio), anagId: a.id || null,
      data: op.data || oggiISO(),
      pagatore: clean(a.pagatore || a.socio || ''), cf: clean(a.cf || '').toUpperCase(),
      importo: r2(importo),
      causale: String(e.causali[tipo] || '').replace('{es}', esBreve(s)),
      dal: ms.length ? ms[0] + '-01' : '', al: ms.length ? fineMese(ms[ms.length - 1]) : '',
      disciplina: clean(a.disciplina || ''),
      minore: clean(a.minore || ''), natoA: clean(a.natoA || ''), natoIl: a.natoIl || '', residenza: clean(a.residenza || ''),
      telefono: clean(a.telefono || '')
    };
  }

  // la ricevuta come immagine vettoriale A5 orizzontale (210 x 148 mm), stessa impaginazione del foglio RICEVUTA
  const xmlEsc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ricevutaSVG(r, ente, opts) {
    const e = { ...enteDefault(), ...(ente || {}) };
    const o = opts || {};
    const SANS = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
    const ARIAL = 'Arial, Helvetica, sans-serif';
    const SERIF = "Cambria, Caladea, 'Times New Roman', serif";
    const PT = 0.3528;
    // larghezza stimata del testo (mm): serve solo a non far sovrapporre i campi lunghi
    const larg = (t, pt, bold) => String(t).length * pt * PT * (bold ? 0.56 : 0.5);
    const txt = (x, y, t, pt, extra) => {
      const x2 = extra || {};
      if (t === '' || t == null) return '';
      let fit = '';
      if (x2.max && larg(t, pt, x2.bold) > x2.max) fit = ' textLength="' + x2.max.toFixed(1) + '" lengthAdjust="spacingAndGlyphs"';
      return '<text x="' + x + '" y="' + y + '" font-family="' + (x2.font || SANS).replace(/"/g, "'") + '" font-size="' + (pt * PT).toFixed(3) + '"' +
        (x2.bold ? ' font-weight="700"' : '') + (x2.anchor ? ' text-anchor="' + x2.anchor + '"' : '') + fit + '>' + xmlEsc(t) + '</text>';
    };
    const data = (iso) => (iso ? fmtData(iso) : '');
    const B = { bold: true };
    let h = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 148" width="' + (o.width || '210mm') + '" height="' + (o.height || '148mm') + '">' +
      '<rect x="0" y="0" width="210" height="148" fill="#fff"/>';
    if (e.logo) h += '<image href="' + e.logo + '" x="19" y="9.5" width="26" height="34.5" preserveAspectRatio="xMidYMid meet"/>';
    e.intestazione.forEach((t, i) => { h += txt(120, 21.3 + i * 4.1, t, 8); });
    h += txt(152.2, 55.6, 'RICEVUTA n.', 14, { anchor: 'end' });
    h += '<rect x="154" y="50.5" width="39" height="6.4" fill="none" stroke="#000" stroke-width="0.35"/>';
    h += txt(173.5, 55.6, r.numeroEtichetta || '', 14, { anchor: 'middle', bold: true, max: 37 });
    h += txt(152.6, 65.2, '€', 14, { anchor: 'end' });
    h += '<rect x="154" y="60.2" width="39" height="6.4" fill="none" stroke="#000" stroke-width="0.35"/>';
    h += txt(173.5, 65.3, isNum(r.importo) && num(r.importo) ? fmt(r.importo) : '', 14, { anchor: 'middle', bold: true, max: 37 });
    h += txt(19.1, 73.4, 'Si dichiara di aver ricevuto da', 10);
    h += txt(68.3, 73.4, r.pagatore, 10, { bold: true, max: 55 });
    h += txt(142.7, 73.4, 'Codice fiscale', 10, { anchor: 'end' });
    h += txt(143.4, 73.4, r.cf, 10, { bold: true, max: 50 });
    h += txt(19.1, 79.9, 'la somma di', 10);
    h += txt(42.2, 79.9, '€', 10);
    h += txt(49, 79.9, isNum(r.importo) && num(r.importo) ? numeroInLettere(r.importo) : '', 10, { bold: true, max: 140 });
    h += txt(19.1, 86.3, 'per', 10);
    h += txt(25, 86.3, r.causale, 10, { bold: true, max: 168 });
    h += txt(19.1, 92.8, 'Periodo dal', 10);
    h += txt(37.7, 92.8, data(r.dal), 10, { bold: true });
    h += txt(119.4, 92.8, 'al', 10, { anchor: 'end' });
    h += txt(120.6, 92.8, data(r.al), 10, { bold: true });
    h += txt(19.1, 99.3, 'Disciplina praticata', 10);
    h += txt(49, 99.3, r.disciplina, 10, { bold: true, max: 140 });
    h += txt(19.1, 106.5, 'Cognome e nome minore', 10);
    h += txt(61, 106.5, r.minore, 10, { bold: true, max: 130 });
    h += txt(19.1, 110.6, 'nato a', 10);
    h += txt(37.7, 110.6, r.natoA, 10, { bold: true, max: 108 });
    h += txt(152.3, 110.6, 'il', 10, { anchor: 'end' });
    h += txt(154, 110.6, data(r.natoIl), 10, { bold: true });
    h += txt(19.1, 114.7, 'residente a', 10);
    h += txt(37.7, 114.7, r.residenza, 10, { bold: true, max: 155 });
    const yPiede = [120.6, 124.5, 127.3];
    e.piede.forEach((t, i) => { h += txt(19.1, yPiede[i] || 127.3 + (i - 2) * 2.8, t, 8, { font: ARIAL, max: 100 }); });
    if (e.firma) h += '<image href="' + e.firma + '" x="124.5" y="118.8" width="47" height="10.3" preserveAspectRatio="xMidYMid meet" opacity="0.92"/>';
    e.timbro.forEach((t, i) => { h += txt(146, 119.3 + i * 3.25, t, i ? 8 : 9, { anchor: 'middle', font: SERIF, bold: i === 0, max: 50 }); });
    h += txt(19.1, 135.6, (e.citta || '') + ', lì', 10);
    h += txt(58.3, 135.6, data(r.data), 10, { anchor: 'middle' });
    h += txt(83.8, 135.6, 'Firma', 10);
    return h + '</svg>';
  }

  // anagrafica dal foglio DATI della maschera Excel: A socio, B pagatore, C codice fiscale, D disciplina,
  // E minore, F nato a, G nato il, H residente a, I quota mensile, J telefono
  function importaAnagrafica(wb) {
    const ws = wb.getWorksheet('DATI') || wb.worksheets.find((w) => /dati|soci|anagraf/i.test(w.name));
    if (!ws) throw new Error('Nel file non trovo il foglio «DATI» con l’elenco dei soci.');
    const out = [];
    const txtC = (c) => { const v = valoreCella(ws.getCell(c)); if (v instanceof Date) return isoUTC(v); return clean(v == null ? '' : String(v)); };
    for (let r = 1; r <= ws.rowCount; r++) {
      const socio = txtC('A' + r);
      if (!socio || /^(nominativ|socio|cognome)/i.test(socio)) continue;
      const g = valoreCella(ws.getCell('G' + r));
      const quota = valoreCella(ws.getCell('I' + r));
      const tel = valoreCella(ws.getCell('J' + r));
      out.push({
        socio, pagatore: txtC('B' + r), cf: txtC('C' + r).toUpperCase(), disciplina: txtC('D' + r),
        minore: txtC('E' + r), natoA: txtC('F' + r), natoIl: g instanceof Date ? isoUTC(g) : '', residenza: txtC('H' + r),
        quota: isNum(quota) ? Number(quota) : null, telefono: tel == null ? '' : clean(typeof tel === 'number' ? String(Math.round(tel)) : String(tel))
      });
    }
    return out;
  }
  // unisce le righe importate con l'anagrafica esistente (stesso socio = aggiornato, nuovi = aggiunti)
  function unisciAnagrafica(attuale, importata, newId) {
    const lista = (attuale || []).map((a) => ({ ...a }));
    let nuovi = 0, aggiornati = 0;
    importata.forEach((x) => {
      const k = normNome(x.socio);
      const a = lista.find((y) => normNome(y.socio) === k);
      if (a) {
        let cambiato = false;
        Object.keys(x).forEach((f) => { if (x[f] !== '' && x[f] !== null && x[f] !== a[f]) { a[f] = x[f]; cambiato = true; } });
        if (cambiato) aggiornati++;
      } else { lista.push({ id: newId(), ...x }); nuovi++; }
    });
    lista.sort((a, b) => a.socio.localeCompare(b.socio, 'it'));
    return { lista, nuovi, aggiornati };
  }

  // ---------------------------------------------------------------- Excel: costanti di stile
  const ACC = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
  const DATEF = 'mm-dd-yy'; // formato data predefinito di Excel (n. 14): si adatta alla lingua
  const SERIF = 'Book Antiqua';
  const LG = "'Libro Giornale'";
  const RANGE = 20000;
  const q = (s) => '"' + String(s).replace(/"/g, '""').replace(/([*?~])/g, '~$1') + '"';
  const sumifD = (acc) => 'SUMIF(' + LG + '!$F$1:$F$' + RANGE + ',' + q(acc) + ',' + LG + '!$D$1:$D$' + RANGE + ')';
  const sumifA = (acc) => 'SUMIF(' + LG + '!$F$1:$F$' + RANGE + ',' + q(acc) + ',' + LG + '!$E$1:$E$' + RANGE + ')';
  const fNetto = (c) => ((c.t === 'C' || c.t === 'A') ? sumifD(c.n) + '-' + sumifA(c.n) : sumifA(c.n) + '-' + sumifD(c.n));
  function toDate(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  // ---------------------------------------------------------------- Excel: esportazione
  function esportaWorkbook(ExcelJS, s, ops) {
    const K = calcola(s, ops);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bilancio ASD';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    const titoloEs = 'ESERCIZIO SOCIALE ' + s.es;
    const thin = { style: 'thin' }, med = { style: 'medium' };
    const font = (o) => ({ name: SERIF, size: 10, ...(o || {}) });
    const arial = (o) => ({ name: 'Arial', size: 10, ...(o || {}) });
    const F = (formula, result) => ({ formula, result: result === undefined ? undefined : r2(result) });
    const fineDate = toDate(s.fine);
    const finePrec = toDate((Number(s.fine.slice(0, 4)) - 1) + s.fine.slice(4));

    function titoli(ws, a, b, t1, t2, opt) {
      const o = opt || {};
      ws.mergeCells(a + '1:' + b + '1');
      ws.mergeCells(a + '2:' + b + '2');
      ws.getCell(a + '1').value = t1;
      ws.getCell(a + '1').font = font({ size: o.size1 || 24, bold: !!o.bold });
      ws.getCell(a + '1').alignment = { horizontal: 'center' };
      ws.getCell(a + '2').value = t2;
      ws.getCell(a + '2').font = font({ size: 20, bold: !!o.bold });
      ws.getCell(a + '2').alignment = { horizontal: 'center' };
      ws.getRow(1).height = o.h1 || 31.2;
      ws.getRow(2).height = o.h2 || 25.8;
    }

    // ---------- Libro Giornale
    const lg = wb.addWorksheet('Libro Giornale', { views: [{ zoomScale: 130 }] });
    lg.properties.defaultColWidth = 9.109375;
    [12.11, 12.33, 47.55, 12.33, 9.11, 36.44, 9.11].forEach((w, i) => { lg.getColumn(i + 1).width = w; });
    titoli(lg, 'A', 'F', 'LIBRO GIORNALE', titoloEs);
    lg.getRow(3).height = 5.25;
    lg.getRow(4).height = 24;
    ['N. Operazione', 'Data', 'Operazione', 'Dare', 'Avere', 'Conto'].forEach((h, i) => {
      const c = lg.getRow(4).getCell(i + 1);
      c.value = h;
      c.font = arial({ bold: true });
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: i === 0 };
      c.border = { left: i === 0 ? med : thin, right: i === 5 ? med : thin, top: med, bottom: med };
    });
    let row = 5;
    K.sorted.forEach((op) => {
      const r0 = row, n = op.righe.length || 1;
      const r1 = r0 + n - 1;
      const cA = lg.getCell(r0, 1), cB = lg.getCell(r0, 2);
      cA.value = op._n;
      cB.value = toDate(op.data);
      cB.numFmt = DATEF;
      op.righe.forEach((rg, i) => {
        const r = r0 + i;
        const x = lg.getRow(r);
        x.height = 15;
        x.getCell(3).value = rg.desc || null;
        x.getCell(4).value = isNum(rg.dare) && num(rg.dare) !== 0 ? r2(rg.dare) : null;
        x.getCell(5).value = isNum(rg.avere) && num(rg.avere) !== 0 ? r2(rg.avere) : null;
        x.getCell(6).value = rg.conto || null;
        if (isNum(rg.ric)) { x.getCell(7).value = Number(rg.ric); x.getCell(7).font = font(); x.getCell(7).alignment = { horizontal: 'left' }; }
      });
      // bordi come nel file originale: N. e Data uniti senza righe interne, cornice media attorno all'operazione
      for (let r = r0; r <= r1; r++) {
        const top = r === r0 ? med : thin, bottom = r === r1 ? med : thin;
        for (let c = 1; c <= 6; c++) {
          const cell = lg.getCell(r, c);
          cell.font = font();
          if (c <= 2) {
            const b = { left: c === 1 ? med : thin, right: thin };
            if (r === r0) b.top = med;
            if (r === r1) b.bottom = med;
            cell.border = b;
          } else cell.border = { left: thin, right: c === 6 ? med : thin, top, bottom };
          if (c === 1) cell.alignment = { horizontal: 'right', vertical: 'middle' };
          else if (c === 2) { cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.numFmt = DATEF; }
          else if (c === 4 || c === 5) { cell.numFmt = ACC; cell.alignment = { horizontal: 'right' }; }
          else cell.alignment = { horizontal: 'left', shrinkToFit: c === 3 };
        }
      }
      // unione dopo aver applicato gli stili, così ogni cella conserva i suoi bordi
      if (n > 1) { lg.mergeCellsWithoutStyle(r0, 1, r1, 1); lg.mergeCellsWithoutStyle(r0, 2, r1, 2); }
      row = r1 + 1;
    });
    const lgLast = row - 1;
    // elenco conti a lato (come nell'originale)
    const lista = (col, titolo, tipo, startRow) => {
      const h = lg.getCell(startRow, col);
      h.value = titolo; h.font = arial({ size: 16, bold: true }); h.alignment = { horizontal: 'left' };
      let r = startRow + 1;
      s.conti.filter((c) => c.t === tipo).forEach((c) => {
        const cell = lg.getCell(r, col); cell.value = c.n; cell.font = font(); cell.alignment = { horizontal: 'left' }; r++;
      });
      return r;
    };
    let rr = lista(8, 'ricavi', 'R', 4);
    lista(8, 'costi', 'C', rr + 2);
    rr = lista(15, 'crediti', 'A', 4);
    lista(15, 'debiti', 'P', rr + 3);
    lg.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A$1:F$' + Math.max(lgLast, 5), printTitlesRow: '1:4', margins: { left: 0.197, right: 0.197, top: 0.197, bottom: 0.197, header: 0.512, footer: 0.512 }, horizontalCentered: true };

    // ---------- Rendiconto Economico
    const re = wb.addWorksheet('Rendiconto Economico', { views: [{ showGridLines: false }] });
    [34.9, 10.9, null, 34.9, 10.9].forEach((w, i) => { if (w) re.getColumn(i + 1).width = w; });
    titoli(re, 'A', 'E', 'RENDICONTO ECONOMICO', titoloEs);
    re.getRow(6).height = 18;
    re.getCell('A6').value = 'COSTI'; re.getCell('A6').font = font({ size: 14, bold: true });
    re.getCell('D6').value = 'RICAVI'; re.getCell('D6').font = font({ size: 14, bold: true });
    const layRE = (sezioni, colL, colV) => {
      let r = 8;
      const sezRows = [];
      sezioni.forEach((sez) => {
        const rs = r++;
        const gRows = [];
        sez.gruppi.forEach((g) => {
          const rg = r++;
          gRows.push(rg);
          const lc = re.getCell(colL + rg), vc = re.getCell(colV + rg);
          lc.value = g.label; lc.font = font({ bold: true });
          vc.numFmt = ACC; vc.font = font({ bold: true });
          if (g.single) {
            const c = g.voci[0];
            vc.value = c ? F(fNetto(c.conto), c.v) : 0;
            if (c && c.label !== g.label) lc.value = c.label;
          } else {
            const first = r;
            g.voci.forEach((vo) => {
              const a = re.getCell(colL + r), b = re.getCell(colV + r);
              a.value = vo.label; a.font = font();
              b.value = F(fNetto(vo.conto), vo.v); b.numFmt = ACC; b.font = font();
              r++;
            });
            vc.value = g.voci.length ? F('SUM(' + colV + first + ':' + colV + (r - 1) + ')', g.v) : 0;
          }
          r++; // riga vuota
        });
        const lc = re.getCell(colL + rs), vc = re.getCell(colV + rs);
        lc.value = sez.label; lc.font = font({ bold: true });
        vc.value = F(gRows.map((x) => colV + x).join('+'), sez.v); vc.numFmt = ACC; vc.font = font({ bold: true });
        sezRows.push(rs);
      });
      return { end: r, sezRows };
    };
    const lc = layRE(K.re.costi, 'A', 'B');
    const lr = layRE(K.re.ricavi, 'D', 'E');
    const T = Math.max(lc.end, lr.end);
    const setRE = (addr, v, opts) => { const c = re.getCell(addr); c.value = v; c.font = font({ bold: true }); if (opts && opts.num) c.numFmt = ACC; if (opts && opts.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; };
    setRE('A' + T, 'Totale costi'); setRE('B' + T, F(lc.sezRows.map((x) => 'B' + x).join('+'), K.re.totC), { num: 1 });
    setRE('D' + T, 'Totale ricavi'); setRE('E' + T, F(lr.sezRows.map((x) => 'E' + x).join('+'), K.re.totR), { num: 1 });
    const RS = T + 11;
    setRE('A' + (T + 1), "Avanzo d'esercizio"); setRE('B' + (T + 1), F('IF(B' + RS + '>0,B' + RS + ',0)', K.re.avanzo), { num: 1 });
    setRE('D' + (T + 1), "(Disavanzo d'esercizio)"); setRE('E' + (T + 1), F('IF(B' + RS + '<0,-B' + RS + ',0)', K.re.disavanzo), { num: 1 });
    setRE('A' + (T + 2), 'Totale a pareggio'); setRE('B' + (T + 2), F('SUM(B' + T + ':B' + (T + 1) + ')', K.re.totC + K.re.avanzo), { num: 1 });
    setRE('D' + (T + 2), 'Totale a pareggio'); setRE('E' + (T + 2), F('SUM(E' + T + ':E' + (T + 1) + ')', K.re.totR + K.re.disavanzo), { num: 1 });
    setRE('A' + (T + 5), 'RIEPILOGO');
    setRE('A' + (T + 7), 'TOTALE RICAVI'); setRE('B' + (T + 7), F('E' + T, K.re.totR), { num: 1, fill: 1 });
    setRE('A' + (T + 9), 'TOTALE COSTI'); setRE('B' + (T + 9), F('B' + T, K.re.totC), { num: 1, fill: 1 });
    setRE('A' + RS, 'SALDO FINALE'); setRE('B' + RS, F('B' + (T + 7) + '-B' + (T + 9), K.re.saldo), { num: 1, fill: 1 });
    for (let r = 7; r <= RS; r++) re.getRow(r).height = 13.8;
    re.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true, margins: { left: 0.394, right: 0.394, top: 0.394, bottom: 0.394, header: 0.512, footer: 0.512 }, printArea: 'A$1:E$' + (RS + 3) };
    const REF = { avanzo: "'Rendiconto Economico'!B" + (T + 1), disavanzo: "'Rendiconto Economico'!E" + (T + 1) };

    // ---------- Stato Patrimoniale
    const sp = wb.addWorksheet('Stato Patrimoniale', { views: [{ showGridLines: false, zoomScale: 115 }] });
    [34.9, 10.9, null, 34.9, 10.9].forEach((w, i) => { if (w) sp.getColumn(i + 1).width = w; });
    titoli(sp, 'A', 'E', 'STATO PATRIMONIALE', titoloEs);
    sp.getRow(5).height = 18;
    sp.getCell('A5').value = 'ATTIVITÀ'; sp.getCell('A5').font = font({ size: 14, bold: true });
    sp.getCell('D5').value = ' PASSIVITÀ'; sp.getCell('D5').font = font({ size: 14, bold: true });
    const laySP = (gruppi, colL, colV) => {
      let r = 7;
      const gRows = [];
      gruppi.forEach((g) => {
        const rg = r++;
        gRows.push(rg);
        const a = sp.getCell(colL + rg), b = sp.getCell(colV + rg);
        a.value = g.label; a.font = font({ bold: true });
        b.numFmt = ACC; b.font = font({ bold: true });
        if (g.evid) b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
        const first = r;
        g.voci.forEach((vo) => {
          const x = sp.getCell(colL + r), y = sp.getCell(colV + r);
          x.value = vo.label; x.font = font();
          let f = fNetto(vo.conto);
          if (vo.conto.fin === 'cassa') f += "+'Bilancio Banche'!B6";
          if (vo.conto.fin === 'banca') f += "+'Bilancio Banche'!B7";
          y.value = F(f, vo.v); y.numFmt = ACC; y.font = font();
          r++;
        });
        b.value = g.voci.length ? F('SUM(' + colV + first + ':' + colV + (r - 1) + ')', g.v) : 0;
        r++;
      });
      return { end: r, gRows };
    };
    const la = laySP(K.sp.attivo, 'A', 'B');
    const lp = laySP(K.sp.passivo, 'D', 'E');
    const TS = Math.max(la.end, lp.end);
    const setSP = (addr, v, bold, isNumber) => { const c = sp.getCell(addr); c.value = v; c.font = font({ bold: !!bold }); if (isNumber) c.numFmt = ACC; };
    setSP('A' + TS, 'TOTALE ATTIVITÀ', 1); setSP('B' + TS, F(la.gRows.map((x) => 'B' + x).join('+'), K.sp.totA), 1, 1);
    setSP('D' + TS, 'TOTALE PASSIVITÀ', 1); setSP('E' + TS, F(lp.gRows.map((x) => 'E' + x).join('+'), K.sp.totP), 1, 1);
    setSP('A' + (TS + 1), 'Disavanzo dell’esercizio'); setSP('B' + (TS + 1), F(REF.disavanzo, K.sp.disavanzo), 0, 1);
    setSP('D' + (TS + 1), 'Avanzo dell’esercizio'); setSP('E' + (TS + 1), F(REF.avanzo, K.sp.avanzo), 0, 1);
    setSP('D' + (TS + 2), 'Fondo comune'); setSP('E' + (TS + 2), r2(s.fondo), 0, 1);
    setSP('A' + (TS + 4), 'A PAREGGIO', 1); setSP('B' + (TS + 4), F('B' + TS + '+B' + (TS + 1), K.sp.parA), 1, 1);
    setSP('D' + (TS + 4), 'A PAREGGIO', 1); setSP('E' + (TS + 4), F('E' + TS + '+E' + (TS + 1) + '+E' + (TS + 2), K.sp.parP), 1, 1);
    for (let r = 7; r <= TS + 4; r++) sp.getRow(r).height = 13.8;
    sp.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.394, right: 0.394, top: 0.394, bottom: 0.394, header: 0.512, footer: 0.512 }, printArea: 'A$1:E$' + (TS + 4) };

    // ---------- Bilancio Banche
    const bb = wb.addWorksheet('Bilancio Banche', { views: [{ showGridLines: false, zoomScale: 175 }] });
    [24.8, 14.6, 8.9, 9.4, 8.9, 8.9, 11].forEach((w, i) => { bb.getColumn(i + 1).width = w; });
    titoli(bb, 'A', 'G', "SALDO DISPONIBILITA' FINANZIARIE", titoloEs, { size1: 22, h1: 28.8 });
    const cassaN = contoFin(s, 'cassa').n, bancaN = contoFin(s, 'banca').n;
    const bbSet = (addr, v, bold, isNumber) => { const c = bb.getCell(addr); c.value = v; c.font = arial({ bold: !!bold }); if (isNumber) c.numFmt = ACC; };
    bbSet('A5', 'SALDI INIZIALI (AL ' + fmtData(s.inizio) + ')');
    bbSet('A6', cassaN.toUpperCase()); bbSet('B6', r2(s.saldi.cassa), 0, 1);
    bbSet('A7', 'BANCA'); bbSet('B7', r2(s.saldi.banca), 0, 1);
    bbSet('A8', 'TOTALE', 1); bbSet('B8', F('SUM(B6:B7)', num(s.saldi.cassa) + num(s.saldi.banca)), 1, 1);
    bbSet('A11', 'SALDI FINALI (AL ' + fmtData(s.fine) + ')');
    bbSet('A12', cassaN.toUpperCase()); bbSet('B12', F(sumifD(cassaN) + '-' + sumifA(cassaN) + '+B6', K.cassa.finale.cassa), 0, 1);
    bbSet('A13', 'BANCA, PAYPAL E SUMUP'); bbSet('B13', F(sumifD(bancaN) + '-' + sumifA(bancaN) + '+B7', K.cassa.finale.banca), 0, 1);
    bbSet('A14', 'TOTALE', 1); bbSet('B14', F('SUM(B12:B13)', K.cassa.finale.cassa + K.cassa.finale.banca), 1, 1);
    bb.pageSetup = { orientation: 'portrait', paperSize: 9, horizontalCentered: true, margins: { left: 0.787, right: 0.787, top: 0.984, bottom: 0.984, header: 0.512, footer: 0.512 }, printArea: 'A$1:G$16' };

    // ---------- Cassa
    const cs = wb.addWorksheet('Cassa', { views: [{ showGridLines: false, zoomScale: 130 }] });
    cs.properties.defaultColWidth = 9.109375;
    [10.89, 12.33, 59.33, 8.89, 9.11, 9.55, 8.89, 9.11, 9.55].forEach((w, i) => { cs.getColumn(i + 1).width = w; });
    titoli(cs, 'A', 'I', 'REGISTRO CASSA', titoloEs);
    const hdr = (addr, v, wrap) => { const c = cs.getCell(addr); c.value = v; c.font = arial({ bold: true }); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: !!wrap }; };
    hdr('A5', 'N.    operazione', 1); hdr('B5', 'Data'); hdr('C5', 'Operazione');
    hdr('D5', etichetta(contoFin(s, 'cassa')), 1); hdr('G5', etichetta(contoFin(s, 'banca')), 1);
    hdr('D6', 'Entrate', 1); hdr('E6', 'Uscite', 1); hdr('F6', 'Saldo', 1); hdr('G6', 'Entrate', 1); hdr('H6', 'Uscite', 1); hdr('I6', 'Saldo', 1);
    // bordi dell'intestazione come nel foglio originale
    const HB = {
      5: ['-/t/m/m', 't/t/m/m', 't/m/m/m', 'm/m/m/m', '-/-/m/m', '-/m/m/m', 'm/m/m/m', '-/-/m/m', '-/m/m/m'],
      6: ['-/t/-/m', 't/t/-/m', 't/m/-/m', 'm/t/m/-', 't/t/m/-', 't/m/m/-', 'm/t/m/-', 't/t/m/-', 't/m/m/-']
    };
    const bd = (code) => { const k = ['left', 'right', 'top', 'bottom']; const o = {}; code.split('/').forEach((x, i) => { if (x === 'm') o[k[i]] = med; else if (x === 't') o[k[i]] = thin; }); return o; };
    for (let r = 5; r <= 6; r++) {
      cs.getRow(r).height = 13.8;
      for (let c = 1; c <= 9; c++) cs.getCell(r, c).border = bd(HB[r][c - 1]);
    }
    ['A5:A6', 'B5:B6', 'C5:C6', 'D5:F5', 'G5:I5'].forEach((m) => cs.mergeCellsWithoutStyle(m));
    const csRow = (r, vals, fC, fB) => {
      const x = cs.getRow(r);
      x.height = 15;
      for (let c = 1; c <= 9; c++) {
        const cell = x.getCell(c);
        cell.font = font();
        cell.border = { left: (c === 1 || c === 4) ? med : thin, right: (c === 6 || c === 9) ? med : (c === 3 ? undefined : thin), top: thin, bottom: thin };
        if (c === 1) cell.alignment = { horizontal: 'right', vertical: 'middle' };
        if (c === 2) { cell.alignment = { horizontal: 'center' }; cell.numFmt = DATEF; }
        if (c === 3) cell.alignment = { horizontal: 'left', shrinkToFit: true };
        if (c >= 4) { cell.numFmt = ACC; cell.alignment = { horizontal: 'right' }; }
      }
      vals.forEach((v, i) => { if (v !== undefined && v !== null && v !== 0) x.getCell(i + 1).value = v; });
      x.getCell(6).value = fC; x.getCell(9).value = fB;
    };
    csRow(7, [null, null, 'SALDO INIZIALE'], F("'Bilancio Banche'!B6", s.saldi.cassa), F("'Bilancio Banche'!B7", s.saldi.banca));
    for (let c = 1; c <= 9; c++) { const cell = cs.getRow(7).getCell(c); cell.border = { ...cell.border, top: med }; }
    let cr = 8;
    K.cassa.rows.forEach((x) => {
      csRow(cr, [x.n, toDate(x.data), x.desc, x.ce, x.cu, undefined, x.be, x.bu], F('F' + (cr - 1) + '+D' + cr + '-E' + cr, x.sc), F('I' + (cr - 1) + '+G' + cr + '-H' + cr, x.sb));
      cr++;
    });
    cs.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A$1:I$' + Math.max(cr - 1, 7), printTitlesRow: '1:6', horizontalCentered: true, margins: { left: 0.787, right: 0.787, top: 0.394, bottom: 0.394, header: 0.512, footer: 0.512 } };

    // ---------- Rendiconto per Cassa
    const rc = wb.addWorksheet('Rendiconto per Cassa', { views: [{ zoomScale: 115 }] });
    [5.9, 46.2, 11.1, 11.1, 3.8, 5.9, 46.2, 11.1, 11.1].forEach((w, i) => { rc.getColumn(i + 1).width = w; });
    titoli(rc, 'B', 'H', 'RENDICONTO PER CASSA', titoloEs, { bold: true, h1: 30.6, h2: 25.2 });
    const RV = K.rpc;
    const codeFormula = (code) => {
      const parts = s.conti.filter((c) => c.rpc === code).map((c) => (rpcSide(code) === 'E' ? sumifA(c.n) + '-' + sumifD(c.n) : sumifD(c.n) + '-' + sumifA(c.n)));
      return parts.length ? parts.join('+') : null;
    };
    const cellV = (addr, formula, result) => { const c = rc.getCell(addr); c.value = formula ? F(formula, result) : r2(result || 0); c.numFmt = ACC; };
    const box = (r) => { for (let c = 1; c <= 9; c++) { const cell = rc.getCell(r, c); if (!cell.font || cell.font.name !== SERIF) cell.font = font(cell.font && cell.font.bold ? { bold: true } : {}); cell.border = { left: thin, right: thin, top: thin, bottom: thin }; } };
    const txt = (addr, v, o) => { const c = rc.getCell(addr); c.value = v; c.font = font({ bold: !!(o && o.bold) }); c.alignment = { horizontal: (o && o.h) || 'left', vertical: 'middle', wrapText: !!(o && o.wrap) }; };
    const dateCell = (addr, d) => { const c = rc.getCell(addr); c.value = d; c.numFmt = DATEF; c.font = font(); c.alignment = { horizontal: 'center' }; };
    const tall = [9, 20, 54, 55, 56, 58];
    RPC_ROWS.forEach((row) => {
      const r = row.r;
      rc.getRow(r).height = tall.includes(r) ? 27.6 : 13.8;
      if (row.t === 'hdr' || row.t === 'hdr2') {
        txt('B' + r, row.L, { bold: true, wrap: true }); txt('G' + r, row.R, { bold: true, wrap: true });
        dateCell('C' + r, fineDate); dateCell('D' + r, finePrec); dateCell('H' + r, fineDate); dateCell('I' + r, finePrec);
        box(r);
      } else if (row.t === 'sec') {
        txt('B' + r, row.L, { bold: true, wrap: true }); txt('G' + r, row.R, { bold: true, wrap: true }); box(r);
      } else if (row.t === 'line') {
        if (row.Lc) {
          txt('A' + r, row.Lc); txt('B' + r, row.L, { wrap: true });
          cellV('C' + r, codeFormula(row.Lc), num(RV.codes.cur[row.Lc]));
          cellV('D' + r, null, num((s.rpcPrec || {})[row.Lc]));
        }
        if (row.Rc) {
          txt('F' + r, row.Rc); txt('G' + r, row.R, { wrap: true });
          cellV('H' + r, codeFormula(row.Rc), num(RV.codes.cur[row.Rc]));
          cellV('I' + r, null, num((s.rpcPrec || {})[row.Rc]));
        }
        box(r);
      } else if (row.t === 'tot') {
        txt('B' + r, 'Totale', { h: 'right' }); txt('G' + r, 'Totale', { h: 'right' });
        cellV('C' + r, 'SUM(C' + row.Lsum[0] + ':C' + row.Lsum[1] + ')', RV.cur['L' + r]);
        cellV('D' + r, 'SUM(D' + row.Lsum[0] + ':D' + row.Lsum[1] + ')', RV.prev['L' + r]);
        cellV('H' + r, 'SUM(H' + row.Rsum[0] + ':H' + row.Rsum[1] + ')', RV.cur['R' + r]);
        cellV('I' + r, 'SUM(I' + row.Rsum[0] + ':I' + row.Rsum[1] + ')', RV.prev['R' + r]);
        box(r);
      } else if (row.t === 'diff') {
        txt('G' + r, row.R, { h: 'right' });
        cellV('H' + r, 'H' + row.of + '-C' + row.of, RV.cur['R' + r]);
        cellV('I' + r, 'I' + row.of + '-D' + row.of, RV.prev['R' + r]);
        box(r);
      } else if (row.t === 'gtot') {
        txt('B' + r, row.L, { bold: true, wrap: true }); txt('G' + r, row.R, { bold: true, wrap: true });
        cellV('C' + r, row.of.map((x) => 'C' + x).join('+'), RV.cur['L' + r]);
        cellV('D' + r, row.of.map((x) => 'D' + x).join('+'), RV.prev['L' + r]);
        cellV('H' + r, row.of.map((x) => 'H' + x).join('+'), RV.cur['R' + r]);
        cellV('I' + r, row.of.map((x) => 'I' + x).join('+'), RV.prev['R' + r]);
        box(r);
      } else if (row.t === 'res') {
        box(r);
        rc.mergeCells('A' + r + ':G' + r);
        txt('A' + r, row.A, { h: 'right' });
        const fm = { gestione: ['H49-C49', 'I49-D49'], dopoImposte: ['H50-H51', 'I50-I51'], investimenti: ['H59-C59-H60', 'I59-D59-I60'], ref52: ['H52', 'I52'], ref61: ['H61', 'I61'], complessivo: ['H64+H65', 'I64+I65'] }[row.f];
        cellV('H' + r, fm[0], RV.cur['R' + r]);
        cellV('I' + r, fm[1], RV.prev['R' + r]);
      } else if (row.t === 'imp') {
        box(r);
        rc.mergeCells('B' + r + ':G' + r);
        txt('A' + r, row.code); txt('B' + r, row.label);
        cellV('H' + r, codeFormula(row.code), RV.cur['R' + r]);
        cellV('I' + r, null, RV.prev['R' + r]);
      } else if (row.t === 'dates') {
        dateCell('H' + r, fineDate); dateCell('I' + r, finePrec);
        rc.getCell('H' + r).border = { left: thin, right: thin, top: thin, bottom: thin };
        rc.getCell('I' + r).border = { left: thin, right: thin, top: thin, bottom: thin };
      } else if (row.t === 'cb') {
        box(r);
        rc.mergeCells('B' + r + ':G' + r);
        txt('A' + r, row.code); txt('B' + r, row.label, { bold: !!row.bold });
        if (row.fin === 'cassa') { cellV('H' + r, "'Bilancio Banche'!B12", RV.cur.R70); cellV('I' + r, "'Bilancio Banche'!B6", RV.prev.R70); }
        if (row.fin === 'banca') { cellV('H' + r, "'Bilancio Banche'!B13", RV.cur.R71); cellV('I' + r, "'Bilancio Banche'!B7", RV.prev.R71); }
      }
    });
    rc.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.315, right: 0.315, top: 0.354, bottom: 0.354, header: 0.315, footer: 0.315 }, printArea: 'A$1:I$71' };

    // ---------- Utilizzo contributi
    const uc = wb.addWorksheet('UTILIZZO CONTRIBUTI');
    [30.9, 10.3, 26.1, 9.1, 9.1, 9.1].forEach((w, i) => { uc.getColumn(i + 1).width = w; });
    const ent = (s.contributi && s.contributi.entrate) || [], usc = (s.contributi && s.contributi.uscite) || [];
    const nU = Math.max(ent.length, usc.length, 1);
    const totE = r2(ent.reduce((x, y) => x + num(y.importo), 0)), totU = r2(usc.reduce((x, y) => x + num(y.importo), 0));
    const ucSet = (addr, v, bold, isNumber) => { const c = uc.getCell(addr); c.value = v; c.font = arial({ bold: !!bold }); if (isNumber) c.numFmt = ACC; };
    ucSet('A1', 'ENTRATE', 1); ucSet('B1', F('SUM(B2:B' + (nU + 20) + ')', totE), 1, 1);
    ucSet('C1', 'USCITE', 1); ucSet('D1', F('SUM(D2:D' + (nU + 20) + ')', totU), 1, 1);
    ucSet('E1', 'NETTO', 1); ucSet('F1', F('B1-D1', totE - totU), 1, 1);
    ent.forEach((e, i) => { ucSet('A' + (i + 2), e.desc || ''); ucSet('B' + (i + 2), r2(e.importo), 0, 1); });
    usc.forEach((e, i) => { ucSet('C' + (i + 2), e.desc || ''); ucSet('D' + (i + 2), r2(e.importo), 0, 1); });

    return wb;
  }

  // ---------------------------------------------------------------- Excel: importazione
  function cellVal(cell) {
    if (!cell) return null;
    if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
    let v = cell.value;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('result' in v) v = v.result;
      else if (v.richText) v = v.richText.map((t) => t.text).join('');
      else if ('text' in v) v = v.text;
      else if (v.error) v = null;
      else if ('formula' in v || 'sharedFormula' in v) v = null;
    }
    if (v && typeof v === 'object' && v.error) v = null;
    return v === undefined ? null : v;
  }
  function formulaSemplice(cell) {
    const v = cell && cell.value;
    if (v && typeof v === 'object' && typeof v.formula === 'string' && /^[\d.,+\-\s]+$/.test(v.formula)) {
      return r2(v.formula.replace(/\s/g, '').split(/(?=[+-])/).reduce((t, p) => t + Number(p), 0));
    }
    return null;
  }
  function dateISO(v) {
    if (v instanceof Date) {
      return v.getUTCFullYear() + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') + '-' + String(v.getUTCDate()).padStart(2, '0');
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return dateISO(d);
    }
    if (typeof v === 'string') {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v.trim());
      if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    }
    return null;
  }
  function importaWorkbook(wb, opts) {
    const o = opts || {};
    const lg = wb.getWorksheet('Libro Giornale');
    if (!lg) throw new Error('Nel file manca il foglio «Libro Giornale».');
    const t2 = String(cellVal(lg.getCell('A2')) || '');
    const m = /(\d{4})\s*[-\/]\s*(\d{4})/.exec(t2);
    const es = m ? m[1] + '-' + m[2] : (o.es || '2026-2027');
    const s = nuoveImpostazioni(es);
    const ops = [];
    let cur = null;
    const maxR = lg.actualRowCount ? Math.max(lg.rowCount, lg.actualRowCount) : lg.rowCount;
    for (let r = 5; r <= maxR; r++) {
      const row = lg.getRow(r);
      const a = cellVal(row.getCell(1));
      const desc = cellVal(row.getCell(3));
      const d = cellVal(row.getCell(4));
      const e = cellVal(row.getCell(5));
      const f = cellVal(row.getCell(6));
      const g = cellVal(row.getCell(7));
      if (isNum(a) && typeof a !== 'boolean') {
        cur = { n: Number(a), data: dateISO(cellVal(row.getCell(2))), righe: [] };
        ops.push(cur);
      }
      if (!cur) continue;
      if ((desc !== null && desc !== '') || isNum(d) || isNum(e) || (f !== null && f !== '')) {
        cur.righe.push({
          desc: desc == null ? '' : clean(desc),
          dare: isNum(d) && Number(d) !== 0 ? r2(d) : null,
          avere: isNum(e) && Number(e) !== 0 ? r2(e) : null,
          conto: f == null ? '' : clean(f),
          ric: isNum(g) ? Number(g) : null
        });
      }
    }
    // "Raccolte pubbliche di fondi" nel file originale vale sia come costo (in Dare) sia come ricavo (in Avere):
    // le righe in Dare vanno sul conto di costo, così i rendiconti coincidono con quelli del file
    ops.forEach((op) => op.righe.forEach((r) => {
      if (r.conto === 'Raccolte pubbliche di fondi' && r.dare && !r.avere) r.conto = 'Spese per raccolte pubbliche di fondi';
    }));
    // descrizioni del Registro Cassa
    const descCassa = new Map();
    const cs = wb.getWorksheet('Cassa');
    if (cs) {
      for (let r = 8; r <= cs.rowCount; r++) {
        const n = cellVal(cs.getCell(r, 1)), dsc = cellVal(cs.getCell(r, 3));
        if (isNum(n) && dsc) descCassa.set(Number(n), clean(dsc));
      }
    }
    const bb = wb.getWorksheet('Bilancio Banche');
    if (bb) {
      s.saldi.cassa = r2(num(cellVal(bb.getCell('B6'))));
      s.saldi.banca = r2(num(cellVal(bb.getCell('B7'))));
    }
    const sp = wb.getWorksheet('Stato Patrimoniale');
    if (sp) {
      for (let r = 1; r <= Math.min(sp.rowCount, 200); r++) {
        if (clean(cellVal(sp.getCell(r, 4))).toLowerCase() === 'fondo comune') {
          const c = sp.getCell(r, 5);
          const v = cellVal(c);
          s.fondo = isNum(v) ? r2(v) : (formulaSemplice(c) || 0);
          break;
        }
      }
    }
    const rc = wb.getWorksheet('Rendiconto per Cassa');
    if (rc) {
      const codes = new Set(RPC_CODES.map((x) => x.code));
      for (let r = 1; r <= Math.min(rc.rowCount, 200); r++) {
        const cl = clean(cellVal(rc.getCell(r, 1))), cr = clean(cellVal(rc.getCell(r, 6)));
        if (codes.has(cl)) { const v = cellVal(rc.getCell(r, 4)); if (isNum(v) && Number(v) !== 0) s.rpcPrec[cl] = r2(v); }
        if (codes.has(cr)) { const v = cellVal(rc.getCell(r, 9)); if (isNum(v) && Number(v) !== 0) s.rpcPrec[cr] = r2(v); }
      }
    }
    const uc = wb.getWorksheet('UTILIZZO CONTRIBUTI');
    if (uc) {
      for (let r = 2; r <= Math.min(uc.rowCount, 500); r++) {
        const a = cellVal(uc.getCell(r, 1)), b = cellVal(uc.getCell(r, 2)), c = cellVal(uc.getCell(r, 3)), d = cellVal(uc.getCell(r, 4));
        if (a || isNum(b)) s.contributi.entrate.push({ desc: clean(a), importo: r2(num(b)) });
        if (c || isNum(d)) s.contributi.uscite.push({ desc: clean(c), importo: r2(num(d)) });
      }
    }
    // conti non presenti nel piano predefinito
    const cm = contoMap(s);
    const nuovi = new Map();
    ops.forEach((op) => op.righe.forEach((r) => {
      if (!r.conto || cm.has(r.conto)) return;
      const x = nuovi.get(r.conto) || { d: 0, a: 0 };
      x.d += num(r.dare); x.a += num(r.avere);
      nuovi.set(r.conto, x);
    }));
    nuovi.forEach((x, nome) => { s.conti.push({ n: nome, t: x.d >= x.a ? 'C' : 'R', g: '', rpc: '' }); });
    // operazioni finali: se un numero è ripetuto o fuori sequenza vale la posizione nel giornale
    // (il Registro Cassa è numerato in sequenza), e la differenza viene segnalata
    const seen = new Set();
    const base = ops.length ? ops[0].n : 0;
    const numerazione = [];
    const out = ops.map((op, i) => {
      const atteso = base + i;
      if (op.n !== atteso) numerazione.push({ scritto: op.n, atteso, desc: (op.righe[0] || {}).desc || '' });
      let id = 'i' + String(atteso).padStart(4, '0');
      while (seen.has(id)) id += 'b';
      seen.add(id);
      return {
        id, ord: i, data: op.data, righe: op.righe,
        descCassa: descCassa.get(atteso) || null,
        tipo: i === 0 && op.n === 0 ? 'apertura' : 'importata'
      };
    });
    return { settings: s, ops: out, contiAggiunti: Array.from(nuovi.keys()), numerazione };
  }

  // ---------------------------------------------------------------- nuovo esercizio
  function nuovoEsercizio(s, ops) {
    const K = calcola(s, ops);
    const [y1, y2] = s.es.split('-').map(Number);
    const ns = JSON.parse(JSON.stringify(s));
    ns.es = (y1 + 1) + '-' + (y2 + 1);
    ns.inizio = (Number(s.inizio.slice(0, 4)) + 1) + s.inizio.slice(4);
    ns.fine = (Number(s.fine.slice(0, 4)) + 1) + s.fine.slice(4);
    ns.saldi = { cassa: K.cassa.finale.cassa, banca: K.cassa.finale.banca };
    ns.fondo = r2(num(s.fondo) + K.re.saldo);
    ns.rpcPrec = {};
    Object.keys(K.rpc.codes.cur).forEach((k) => { if (Math.abs(K.rpc.codes.cur[k]) > 0.004) ns.rpcPrec[k] = K.rpc.codes.cur[k]; });
    const avanzo = K.re.saldo;
    const apertura = {
      id: 'a' + ns.es.replace('-', ''), ord: 0, data: null, tipo: 'apertura', descCassa: null,
      righe: avanzo >= 0
        ? [{ desc: 'Avanzo dell’esercizio ' + s.es, dare: r2(avanzo), avere: null, conto: "Avanzo dell'esercizio", ric: null },
          { desc: 'Accantonamento a fondo comune', dare: null, avere: r2(avanzo), conto: 'Fondo comune', ric: null }]
        : [{ desc: 'Utilizzo fondo comune', dare: r2(-avanzo), avere: null, conto: 'Fondo comune', ric: null },
          { desc: 'Disavanzo dell’esercizio ' + s.es, dare: null, avere: r2(-avanzo), conto: 'Disavanzo dell’esercizio', ric: null }]
    };
    return { settings: ns, apertura, riepilogo: { saldi: ns.saldi, fondo: ns.fondo, avanzo } };
  }

  const Core = {
    r2, num, isNum, clean, fmt, parseImporto, fmtData, oggiISO, addMonths, ymLabel, meseNome,
    RE, SP, TIPI, RPC_ROWS, RPC_CODES, CONTI_DEFAULT, rpcSide, rpcSection, gruppiPerTipo, gruppoLabel,
    nuoveImpostazioni, mesiEsercizio, chiaveMese, contoMap, contoFin, etichetta,
    ordina, numera, totaliOp, saldiConti, valoreConto, registroCassa, descCassaAuto,
    rendicontoEconomico, statoPatrimoniale, rendicontoCassa, calcola,
    parsePeriodo, formatPeriodo, situazioneSoci, statoSocio, chiaveSocio,
    commissione, scritturaQuote, scritturaSpesa, scritturaIncasso, scritturaGiroconto, prossimaRicevuta, storicoVoci,
    numeroInLettere, normalizzaTelefono, enteDefault, etichettaRicevuta, trovaAnagrafica, ricevutaDaOperazione, ricevutaSVG, importaAnagrafica, unisciAnagrafica, esBreve,
    mesiForzatiOp, sociOperazione, REG_MEZZI, leggiRegistro, letturaDaArchivio, confrontaRegistro, registroSalvato, registroDaSalvare, grigio, nonIncassareSalvati, nonIncassareSocio, chiavePagamento, ordiniInserimento, normNome, parseNome, punteggioNome, proponiNome, mezzoScrittura,
    esportaWorkbook, importaWorkbook, nuovoEsercizio
  };
  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
