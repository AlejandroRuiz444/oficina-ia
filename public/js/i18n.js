// UI language: English + Turkish.
// The language is picked once on page load: localStorage['cco.lang'] → Turkish if the browser language starts with 'tr' → English.
// Switching saves the choice and reloads the page, so module-level constants (CATS, STATUS…) are built in the right language too.
//
// A dictionary value can take three forms:
//   'Text {name}'            → placeholders are filled from params
//   { one, other }            → plural; the form is picked by params.n (Intl.PluralRules)
//   p => `...`                → function of the params object (for sentences whose word order differs by language)
// A missing key falls back to English, then to the key itself.
//
// Static text in index.html is bound with attributes:
//   data-i18n="k"        textContent      data-i18n-title="k"  title
//   data-i18n-aria="k"   aria-label       data-i18n-tail="k"   the element's last text node (child elements untouched)

const STORE_KEY = 'cco.lang';
export const LANGS = ['en', 'tr'];
const LANG_NAMES = { en: 'English', tr: 'Türkçe' };

function detect() {
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch { /* storage disabled */ }
  if (LANGS.includes(saved)) return saved;
  let nav = '';
  try { nav = String(navigator.language || '').toLowerCase(); } catch { /* unavailable */ }
  return nav.startsWith('tr') ? 'tr' : 'en';
}

export const lang = detect();
export const locale = lang === 'tr' ? 'tr-TR' : 'en-US';

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* storage disabled: the choice can't survive the reload */ }
  location.reload();
}

// ---------------------------------------------------------------- calendar

const CAL = {
  tr: {
    months: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
    short: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
    days: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
    abl: ['tan', 'tan', 'tan', 'dan', 'tan', 'dan', 'dan', 'tan', 'den', 'den', 'dan', 'tan'], // ablative suffix
  },
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
};
const TRC = CAL.tr, ENC = CAL.en;
const pl = (n, one, other) => `${n} ${n === 1 ? one : other}`;

// ---------------------------------------------------------------- Turkish

const tr = {
  'app.name': 'Ajan Ofisi',
  'lang.tip': p => `Dil: ${p.cur} · ${p.next} diline geç`,

  // top bar
  'nav.label': 'Görünüm',
  'tab.pano': 'Pano', 'tab.ofis': 'Ofis', 'tab.akis': 'Akış', 'tab.maliyet': 'Maliyet',
  'tab.pano.tip': 'Pano (1)', 'tab.ofis.tip': 'Ofis (2)', 'tab.akis.tip': 'Akış (3)', 'tab.maliyet.tip': 'Maliyet (4)',
  'conn.live': 'Canlı bağlantı',
  'conn.lost': 'Bağlantı koptu — yeniden deneniyor',
  'kpi.working': 'çalışıyor',
  'kpi.yourTurn': 'sıra sende',
  'kpi.nobody': 'kimse beklemiyor',
  'kpi.waitingTip': 'Seni bekleyen oturum sayısı',
  'kpi.nobodyTip': 'Seni bekleyen oturum yok',
  'kpi.today': 'bugün',
  'kpi.workTip': p => `${p.w} oturum · ${p.s} alt ajan çalışıyor\n${p.m} açık terminal · son 60 dk ${p.tok} çıktı tokenı`,
  'kpi.costTip': p => `Bugün ${p.today} · bu saat ${p.hour} · önceki saat ${p.prev}\nAPI liste fiyatıyla karşılığı, gerçek fatura değil.\nAyrıntı için tıkla (4)`,
  'kpi.costScanning': 'Maliyet taranıyor…',
  'acct.five': '5 saat: {p}',
  'acct.seven': '7 gün: {p}',
  'acct.resets': '{c} sonra sıfırlanır',
  'acct.in': '{c} sonra',
  'bell.on': 'Bir oturum sıra sana geçince çal (açık)',
  'bell.off': 'Bir oturum sıra sana geçince çal (kapalı)',
  'notify.title': '{p} · sıra sende',
  'view.failed': 'Bu görünüm şu an açılamadı.',

  // units and numbers
  'u.s': 'sn', 'u.m': 'dk', 'u.h': 'sa', 'u.d': 'g',
  'num.billion': ' Mr',
  'num.thousandUsd': ' bin',
  'time.minAgo': '{n} dk önce',
  'time.hAgo': '{n} sa önce',
  'time.dAgo': '{n} gün önce',
  'time.thisMin': 'bu dakika',
  'time.now': 'şimdi',

  // dates
  'date.long': p => `${p.d} ${TRC.months[p.m]} ${TRC.days[p.w]}`,
  'date.short': p => `${p.d} ${TRC.short[p.m]}`,
  'date.since': p => `${p.d} ${TRC.months[p.m]}’${TRC.abl[p.m]} beri`,
  'date.monthDays': p => `${TRC.months[p.m]} · ${p.n} gün`,

  // categories, statuses, verbs
  'cat.think': 'Düşünme', 'cat.shell': 'Komut', 'cat.read': 'Okuma · arama', 'cat.edit': 'Düzenleme',
  'cat.web': 'Web · MCP', 'cat.agent': 'Alt ajan', 'cat.other': 'Diğer', 'cat.ask': 'Soru',
  'verb.think': 'Düşünüyor', 'verb.shell': 'Komut çalıştırıyor', 'verb.read': 'Okuyor', 'verb.edit': 'Düzenliyor',
  'verb.web': 'Web’de', 'verb.agent': 'Ajan yönetiyor', 'verb.other': 'Çalışıyor', 'verb.ask': 'Soru soruyor',
  'verb.mcp': '{srv} üzerinde',
  'verb.browser': 'Tarayıcıda',
  'verb.waitSubs': 'Alt ajanları bekliyor',
  'tool.Read': 'Okuyor', 'tool.Grep': 'Arıyor', 'tool.Glob': 'Dosya arıyor', 'tool.LSP': 'Kodu tarıyor',
  'tool.Edit': 'Düzenliyor', 'tool.MultiEdit': 'Düzenliyor', 'tool.Write': 'Dosya yazıyor', 'tool.NotebookEdit': 'Not defteri düzenliyor',
  'tool.Bash': 'Komut çalıştırıyor', 'tool.PowerShell': 'PowerShell çalıştırıyor', 'tool.Monitor': 'İzliyor', 'tool.TaskStop': 'Görev durduruyor',
  'tool.WebFetch': 'Sayfa çekiyor', 'tool.WebSearch': 'Web’de arıyor',
  'tool.Agent': 'Alt ajan başlatıyor', 'tool.Task': 'Alt ajan başlatıyor', 'tool.SendMessage': 'Mesaj gönderiyor', 'tool.Workflow': 'İş akışı yürütüyor',
  'tool.AskUserQuestion': 'Soru soruyor', 'tool.ExitPlanMode': 'Plan onayı bekliyor', 'tool.TodoWrite': 'Plan güncelliyor',
  'tool.Skill': 'Beceri yüklüyor', 'tool.ToolSearch': 'Araç arıyor', 'tool.Artifact': 'Sayfa yayınlıyor', 'tool.ScheduleWakeup': 'Uyanma kuruyor',
  'status.working': 'Çalışıyor', 'status.waiting': 'Sıra sende', 'status.ask': 'Cevabını bekliyor',
  'status.ready': 'Hazır', 'status.dormant': 'Uykuda', 'status.done': 'Bitti', 'status.stale': 'Sessiz',
  'model.other': 'Diğer',
  'agent.sub': 'Alt ajan',

  // activity and events
  'act.waitSubs': '{n} alt ajan bekleniyor',
  'act.thinking': 'Düşünüyor',
  'act.working': 'Çalışıyor',
  'act.parallel': '{n} paralel',
  'act.replied': 'Yanıt verdi, sıradaki isteğini bekliyor.',
  'act.taskDone': 'Görev bitti',
  'act.silent': 'Ses yok',
  'ev.compact': 'Sıkıştırma',
  'ev.compacted': 'Bağlam sıkıştırıldı',
  'ev.prompt': 'İstek',
  'ev.task': 'Görev',
  'ev.scheduled': 'Zamanlı görev',
  'ev.wait': 'Bekleme',
  'ev.ongoing': 'sürüyor',
  'ev.error': 'hata',
  'ev.interrupted': 'kesildi',
  'ev.waitBg': 'Bekleme · arka planda iş sürüyor',
  'ev.wasYourTurn': 'Sıra sendeydi',
  'ev.modelThinking': 'Model düşünüyor',
  'log.think': 'düşünme',
  'log.wait': 'sıra sende',
  'log.prompt': 'istek',

  // drawer
  'dw.close': 'Kapat (Esc)',
  'dw.started': 'başladı {clock} · {ago} önce',
  'dw.bg': 'arka planda',
  'dw.ctxTip': 'Bağlam penceresi: {a} / {b} token',
  'dw.ctx': 'Bağlam',
  'dw.lastHour': 'Son 1 saat',
  'dw.outTok': 'çıktı tokenı',
  'dw.costTipMain': 'Bu oturumun alt ajanlar dahil tüm geçmişinin API liste fiyatıyla karşılığı. Gerçek fatura değil.',
  'dw.costTipSub': 'Bu alt ajanın API liste fiyatıyla karşılığı. Gerçek fatura değil.',
  'dw.cost': 'Maliyet',
  'dw.apiEq': 'API karşılığı',
  'dw.subs': 'Alt ajan',
  'dw.totalTok': 'Toplam token',
  'dw.working': 'çalışıyor',
  'dw.output': 'çıktı',
  'dw.perMin': 'Dakikalık token',
  'dw.last60': 'son 60 dk',
  'dw.task': 'Görev',
  'dw.lastPrompt': 'Son isteğin',
  'dw.summary': 'Özet',
  'dw.lastReply': 'Son yanıt',
  'dw.tools': 'Araçlar',
  'dw.toolsSub': p => `${p.calls} çağrı · ${p.prompts} istek`,
  'dw.subsH': 'Alt ajanlar',
  'dw.subsSub': '{w} çalışıyor · {n} toplam',
  'dw.events': 'Olaylar',
  'dw.newest': 'en yeni üstte',
  'dw.noEvents': 'Henüz olay yok',
  'common.showLess': 'Daha az göster',
  'common.showAll': 'Tümünü göster ({n})',
  'spark.tok': '{t} token',

  // dashboard
  'pano.last60': 'Son 60 dakika',
  'pano.now': 'Şu an ne yapılıyor',
  'pano.costOpen': 'Maliyet sekmesini aç (4)',
  'pano.today': 'Bugün',
  'pano.hourLine': 'bu saat {a} · önceki saat {b}',
  'pano.scanning': 'geçmiş taranıyor…',
  'pano.calculating': 'hesaplanıyor…',
  'pano.calls': p => `dakikada ${p.a} araç çağrısı · saatte ${p.b}`,
  'pano.sparkCalls': '{n} araç çağrısı',
  'pano.mixTip': '{cat}: {n} ajan',
  'pano.noneWorking': 'Şu an çalışan ajan yok',
  'pano.untitled': 'Başlıksız oturum',
  'pano.ctx': 'bağlam',
  'pano.tokTip': 'Son 60 dakikadaki çıktı tokenı · toplam {n} araç çağrısı',
  'pano.tokPerH': 'token/sa',
  'pano.costTip': p => `Bu oturumun${p.subs ? ' (alt ajanlar dahil)' : ''} API liste fiyatıyla karşılığı. Gerçek fatura değil.`,
  'pano.subsWorking': '{n} alt ajan çalışıyor',
  'pano.subsTotal': '· {n} toplam',
  'pano.moreSubs': '+{n} alt ajan daha',
  'pano.lastWords': 'Son söz',
  'pano.summary': 'Özet',
  'pano.empty': 'Açık Claude Code oturumu bulunamadı.',
  'pano.asleep': 'Uykuda · {n}',
  'pano.subsWere': '{n} alt ajan çalışıyordu',

  // timeline
  'akis.r15': '15 dk', 'akis.r60': '1 sa', 'akis.r180': '3 sa', 'akis.r360': '6 sa',
  'akis.subs': 'Alt ajanlar',
  'akis.dormant': 'Uyuyanlar',
  'akis.waitNow': 'Sıra sende (şimdi)',
  'akis.wait': 'Bekleme',
  'akis.prompt': 'İstek',
  'akis.sessions': p => `Oturumlar · son ${p.min >= 60 ? p.min / 60 + ' saat' : p.min + ' dk'}`,

  // cost
  'm.title': 'Maliyet',
  'm.note': 'Rakamlar kullandığın tokenların <b>API liste fiyatıyla karşılığı</b>; aboneliğinle ödediğin tutar değil. Oturum geçmişi diskte olduğu kadarıyla hesaplanır.',
  'm.range': 'Aralık',
  'm.last30': 'Son 30 gün',
  'm.last90': 'Son 90 gün',
  'm.daily': 'Günlük maliyet',
  'm.byModel': 'modele göre',
  'm.table': 'Tablo',
  'm.chart': 'Grafik',
  'm.models': 'Modeller',
  'm.hourly': 'Bugün, saat saat',
  'm.projects': 'Projeler',
  'm.allTimeSub': 'tüm zamanlar',
  'm.preparing': 'Hazırlanıyor…',
  'm.scanning': 'Geçmiş taranıyor',
  'm.files': '{a} / {b} dosya',
  'm.scanTip': 'İlk tarama bitene kadar rakamlar eksik olabilir.',
  'm.upToDate': 'Güncel · son tarama {t}',
  'm.rescanTip': 'Transcript dosyaları yaklaşık 45 saniyede bir yeniden taranır; yalnızca yeni satırlar okunur.',
  'm.today': 'Bugün',
  'm.waitScan': 'tarama bekleniyor',
  'm.recorded': 'kayıtlı geçmiş',
  'm.yesterdayV': 'dün {v}',
  'm.soFar': 'şu ana kadar',
  'm.thisHour': 'Bu saat',
  'm.prevHourV': 'önceki saat {v}',
  'm.hourTip': 'Saat {h}:00 ile şimdi arası',
  'm.last7': 'Son 7 gün',
  'm.avgDay': 'günde ort. {v}',
  'm.thisMonth': 'Bu ay',
  'm.allTime': 'Tüm zamanlar',
  'm.loading': 'Veri yükleniyor…',
  'm.recordsStart': 'kayıtlar {d} tarihinden başlıyor',
  'm.dailyNote': 'Aralık toplamı {a} · kayıtlı günlerde ortalama {b} · en yüksek gün {c}',
  'm.day': 'Gün',
  'm.total': 'Toplam',
  'm.todayLc': 'bugün',
  'm.dailyAria': 'Son {n} günün günlük maliyeti, modele göre yığılmış',
  'm.noBefore': '{d} öncesi kayıt yok',
  'm.inProgress': 'sürüyor',
  'm.noRecords': 'Kayıt yok',
  'm.replies': '{v} model yanıtı',
  'm.hourlySub': 'toplam {a} · dün bu saate kadar {b}',
  'm.hour': 'Saat',
  'm.todayCol': 'Bugün',
  'm.yesterday': 'Dün',
  'm.hourlyAria': 'Bugünün saatlik maliyeti',
  'm.sameHourYest': 'dün aynı saat {v}',
  'm.modelsSub': 'son {n} gün · token',
  'm.noRange': 'Bu aralıkta kayıt yok',
  'm.share': '{p} pay',
  'm.model': 'Model',
  'm.inTip': 'Önbelleğe alınmamış giriş tokenı',
  'm.in': 'Giriş',
  'm.out': 'Çıkış',
  'm.cwTip': 'Önbelleğe yazma (5 dk + 1 sa)',
  'm.cw': 'Önb. yazma',
  'm.crTip': 'Önbellekten okuma',
  'm.cr': 'Önb. okuma',
  'm.cost': 'Maliyet',
  'm.lastAct': 'son etkinlik: {ago}',
  'm.sessions': '{n} oturum',

  // office
  'of.zoomIn': 'Yakınlaş',
  'of.zoomOut': 'Uzaklaş',
  'of.fit': 'Tümünü sığdır (çift tık)',
  'of.noWebgl': 'Bu tarayıcıda WebGL açılamadı; ofis çizilemiyor.',
  'of.lobby': 'AJAN OFİSİ · LOBİ',
  'of.lobbyWorking': 'kişi çalışıyor',
  'of.lobbyWaiting': 'seni bekliyor',
  'of.lobbyRooms': 'oda',
  'of.badgeAsk': 'CEVAP BEKLİYOR',
  'of.badgeWait': 'SIRA SENDE',
  'of.badgeSleep': 'UYKUDA',
  'of.session': 'Oturum',
  'of.chipAsk': 'Cevap bekliyor',
  'of.chipWait': 'Sıra sende',
  'of.rooms': '{b} oda',
  'of.working': '{b} kişi çalışıyor',
  'of.waiting': '{b} kişi seni bekliyor',
  'of.nobody': 'kimse seni beklemiyor',
  'of.empty': 'Şu an açık bir Claude Code oturumu yok.',
  'of.subTip': 'alt ajan',
};

// ---------------------------------------------------------------- English

const en = {
  'app.name': 'Claude Code Office',
  'lang.tip': p => `Language: ${p.cur} · switch to ${p.next}`,

  // top bar
  'nav.label': 'View',
  'tab.pano': 'Dashboard', 'tab.ofis': 'Office', 'tab.akis': 'Timeline', 'tab.maliyet': 'Cost',
  'tab.pano.tip': 'Dashboard (1)', 'tab.ofis.tip': 'Office (2)', 'tab.akis.tip': 'Timeline (3)', 'tab.maliyet.tip': 'Cost (4)',
  'conn.live': 'Live connection',
  'conn.lost': 'Connection lost — reconnecting',
  'kpi.working': 'working',
  'kpi.yourTurn': 'your turn',
  'kpi.nobody': 'no one waiting',
  'kpi.waitingTip': 'Sessions waiting for you',
  'kpi.nobodyTip': 'No sessions are waiting for you',
  'kpi.today': 'today',
  'kpi.workTip': p => `${pl(p.w, 'session', 'sessions')} · ${pl(p.s, 'subagent', 'subagents')} working\n${pl(p.m, 'open terminal', 'open terminals')} · ${p.tok} output tokens in the last 60 min`,
  'kpi.costTip': p => `Today ${p.today} · this hour ${p.hour} · previous hour ${p.prev}\nEquivalent at API list prices, not an actual bill.\nClick for details (4)`,
  'kpi.costScanning': 'Scanning costs…',
  'acct.five': '5-hour: {p}',
  'acct.seven': '7-day: {p}',
  'acct.resets': 'resets in {c}',
  'acct.in': 'in {c}',
  'bell.on': 'Chime when a session hands the turn to you (on)',
  'bell.off': 'Chime when a session hands the turn to you (off)',
  'notify.title': '{p} · your turn',
  'view.failed': 'This view couldn’t be opened right now.',

  // units and numbers
  'u.s': 's', 'u.m': 'm', 'u.h': 'h', 'u.d': 'd',
  'num.billion': 'B',
  'num.thousandUsd': 'k',
  'time.minAgo': '{n} min ago',
  'time.hAgo': '{n} h ago',
  'time.dAgo': { one: '{n} day ago', other: '{n} days ago' },
  'time.thisMin': 'this minute',
  'time.now': 'now',

  // dates
  'date.long': p => `${ENC.days[p.w]}, ${ENC.months[p.m]} ${p.d}`,
  'date.short': p => `${ENC.short[p.m]} ${p.d}`,
  'date.since': p => `since ${ENC.months[p.m]} ${p.d}`,
  'date.monthDays': p => `${ENC.months[p.m]} · ${pl(p.n, 'day', 'days')}`,

  // categories, statuses, verbs
  'cat.think': 'Thinking', 'cat.shell': 'Shell', 'cat.read': 'Read · search', 'cat.edit': 'Edit',
  'cat.web': 'Web · MCP', 'cat.agent': 'Subagent', 'cat.other': 'Other', 'cat.ask': 'Question',
  'verb.think': 'Thinking', 'verb.shell': 'Running a command', 'verb.read': 'Reading', 'verb.edit': 'Editing',
  'verb.web': 'On the web', 'verb.agent': 'Managing agents', 'verb.other': 'Working', 'verb.ask': 'Asking a question',
  'verb.mcp': 'Using {srv}',
  'verb.browser': 'In the browser',
  'verb.waitSubs': 'Waiting for subagents',
  'tool.Read': 'Reading', 'tool.Grep': 'Searching', 'tool.Glob': 'Finding files', 'tool.LSP': 'Scanning code',
  'tool.Edit': 'Editing', 'tool.MultiEdit': 'Editing', 'tool.Write': 'Writing a file', 'tool.NotebookEdit': 'Editing a notebook',
  'tool.Bash': 'Running a command', 'tool.PowerShell': 'Running PowerShell', 'tool.Monitor': 'Monitoring', 'tool.TaskStop': 'Stopping a task',
  'tool.WebFetch': 'Fetching a page', 'tool.WebSearch': 'Searching the web',
  'tool.Agent': 'Starting a subagent', 'tool.Task': 'Starting a subagent', 'tool.SendMessage': 'Sending a message', 'tool.Workflow': 'Running a workflow',
  'tool.AskUserQuestion': 'Asking a question', 'tool.ExitPlanMode': 'Awaiting plan approval', 'tool.TodoWrite': 'Updating the plan',
  'tool.Skill': 'Loading a skill', 'tool.ToolSearch': 'Finding tools', 'tool.Artifact': 'Publishing a page', 'tool.ScheduleWakeup': 'Scheduling a wake-up',
  'status.working': 'Working', 'status.waiting': 'Your turn', 'status.ask': 'Waiting for your answer',
  'status.ready': 'Ready', 'status.dormant': 'Asleep', 'status.done': 'Done', 'status.stale': 'Quiet',
  'model.other': 'Other',
  'agent.sub': 'Subagent',

  // activity and events
  'act.waitSubs': { one: 'Waiting for {n} subagent', other: 'Waiting for {n} subagents' },
  'act.thinking': 'Thinking',
  'act.working': 'Working',
  'act.parallel': '{n} parallel',
  'act.replied': 'Replied. Waiting for your next request.',
  'act.taskDone': 'Task finished',
  'act.silent': 'No activity',
  'ev.compact': 'Compaction',
  'ev.compacted': 'Context compacted',
  'ev.prompt': 'Prompt',
  'ev.task': 'Task',
  'ev.scheduled': 'Scheduled task',
  'ev.wait': 'Waiting',
  'ev.ongoing': 'running',
  'ev.error': 'error',
  'ev.interrupted': 'interrupted',
  'ev.waitBg': 'Waiting · work continues in the background',
  'ev.wasYourTurn': 'Was your turn',
  'ev.modelThinking': 'Model thinking',
  'log.think': 'thinking',
  'log.wait': 'your turn',
  'log.prompt': 'prompt',

  // drawer
  'dw.close': 'Close (Esc)',
  'dw.started': 'started {clock} · {ago} ago',
  'dw.bg': 'in background',
  'dw.ctxTip': 'Context window: {a} / {b} tokens',
  'dw.ctx': 'Context',
  'dw.lastHour': 'Last hour',
  'dw.outTok': 'output tokens',
  'dw.costTipMain': 'This session’s entire history, subagents included, at API list prices. Not an actual bill.',
  'dw.costTipSub': 'This subagent at API list prices. Not an actual bill.',
  'dw.cost': 'Cost',
  'dw.apiEq': 'API-price equivalent',
  'dw.subs': 'Subagents',
  'dw.totalTok': 'Total tokens',
  'dw.working': 'working',
  'dw.output': 'output',
  'dw.perMin': 'Tokens per minute',
  'dw.last60': 'last 60 min',
  'dw.task': 'Task',
  'dw.lastPrompt': 'Your last request',
  'dw.summary': 'Summary',
  'dw.lastReply': 'Last reply',
  'dw.tools': 'Tools',
  'dw.toolsSub': p => `${pl(p.calls, 'call', 'calls')} · ${pl(p.prompts, 'prompt', 'prompts')}`,
  'dw.subsH': 'Subagents',
  'dw.subsSub': '{w} working · {n} total',
  'dw.events': 'Events',
  'dw.newest': 'newest first',
  'dw.noEvents': 'No events yet',
  'common.showLess': 'Show less',
  'common.showAll': 'Show all ({n})',
  'spark.tok': '{t} tokens',

  // dashboard
  'pano.last60': 'Last 60 minutes',
  'pano.now': 'Happening now',
  'pano.costOpen': 'Open the Cost tab (4)',
  'pano.today': 'Today',
  'pano.hourLine': 'this hour {a} · previous hour {b}',
  'pano.scanning': 'scanning history…',
  'pano.calculating': 'calculating…',
  'pano.calls': p => `${p.a} tool ${p.n === 1 ? 'call' : 'calls'} a minute · ${p.b} an hour`,
  'pano.sparkCalls': { one: '{n} tool call', other: '{n} tool calls' },
  'pano.mixTip': { one: '{cat}: {n} agent', other: '{cat}: {n} agents' },
  'pano.noneWorking': 'No agents are working right now',
  'pano.untitled': 'Untitled session',
  'pano.ctx': 'context',
  'pano.tokTip': 'Output tokens in the last 60 minutes · {n} tool calls in total',
  'pano.tokPerH': 'tokens/h',
  'pano.costTip': p => `This session${p.subs ? ' (subagents included)' : ''} at API list prices. Not an actual bill.`,
  'pano.subsWorking': { one: '{n} subagent working', other: '{n} subagents working' },
  'pano.subsTotal': '· {n} total',
  'pano.moreSubs': { one: '+{n} more subagent', other: '+{n} more subagents' },
  'pano.lastWords': 'Last reply',
  'pano.summary': 'Summary',
  'pano.empty': 'No open Claude Code sessions found.',
  'pano.asleep': 'Asleep · {n}',
  'pano.subsWere': { one: '{n} subagent was working', other: '{n} subagents were working' },

  // timeline
  'akis.r15': '15m', 'akis.r60': '1h', 'akis.r180': '3h', 'akis.r360': '6h',
  'akis.subs': 'Subagents',
  'akis.dormant': 'Asleep',
  'akis.waitNow': 'Your turn (now)',
  'akis.wait': 'Waiting',
  'akis.prompt': 'Prompt',
  'akis.sessions': p => `Sessions · last ${p.min >= 60 ? pl(p.min / 60, 'hour', 'hours') : p.min + ' min'}`,

  // cost
  'm.title': 'Cost',
  'm.note': 'Figures show what your tokens would cost at <b>API list prices</b>, not what you pay for your subscription. Only session history still on disk is counted.',
  'm.range': 'Range',
  'm.last30': 'Last 30 days',
  'm.last90': 'Last 90 days',
  'm.daily': 'Daily cost',
  'm.byModel': 'by model',
  'm.table': 'Table',
  'm.chart': 'Chart',
  'm.models': 'Models',
  'm.hourly': 'Today, hour by hour',
  'm.projects': 'Projects',
  'm.allTimeSub': 'all time',
  'm.preparing': 'Preparing…',
  'm.scanning': 'Scanning history',
  'm.files': '{a} / {b} files',
  'm.scanTip': 'Figures may be incomplete until the first scan finishes.',
  'm.upToDate': 'Up to date · last scan {t}',
  'm.rescanTip': 'Transcripts are rescanned about every 45 seconds; only new lines are read.',
  'm.today': 'Today',
  'm.waitScan': 'waiting for the scan',
  'm.recorded': 'recorded history',
  'm.yesterdayV': 'yesterday {v}',
  'm.soFar': 'so far',
  'm.thisHour': 'This hour',
  'm.prevHourV': 'previous hour {v}',
  'm.hourTip': 'From {h}:00 until now',
  'm.last7': 'Last 7 days',
  'm.avgDay': 'avg. {v} a day',
  'm.thisMonth': 'This month',
  'm.allTime': 'All time',
  'm.loading': 'Loading data…',
  'm.recordsStart': 'records start on {d}',
  'm.dailyNote': 'Range total {a} · average on recorded days {b} · peak day {c}',
  'm.day': 'Day',
  'm.total': 'Total',
  'm.todayLc': 'today',
  'm.dailyAria': 'Daily cost for the last {n} days, stacked by model',
  'm.noBefore': 'No records before {d}',
  'm.inProgress': 'in progress',
  'm.noRecords': 'No records',
  'm.replies': { one: '{v} model reply', other: '{v} model replies' },
  'm.hourlySub': 'total {a} · yesterday by this hour {b}',
  'm.hour': 'Hour',
  'm.todayCol': 'Today',
  'm.yesterday': 'Yesterday',
  'm.hourlyAria': 'Today’s hourly cost',
  'm.sameHourYest': 'same hour yesterday {v}',
  'm.modelsSub': 'last {n} days · tokens',
  'm.noRange': 'No records in this range',
  'm.share': '{p} share',
  'm.model': 'Model',
  'm.inTip': 'Uncached input tokens',
  'm.in': 'Input',
  'm.out': 'Output',
  'm.cwTip': 'Cache writes (5 min + 1 h)',
  'm.cw': 'Cache write',
  'm.crTip': 'Cache reads',
  'm.cr': 'Cache read',
  'm.cost': 'Cost',
  'm.lastAct': 'last activity: {ago}',
  'm.sessions': { one: '{n} session', other: '{n} sessions' },

  // office
  'of.zoomIn': 'Zoom in',
  'of.zoomOut': 'Zoom out',
  'of.fit': 'Fit all (double-click)',
  'of.noWebgl': 'WebGL isn’t available in this browser, so the office can’t be drawn.',
  'of.lobby': 'CLAUDE CODE OFFICE · LOBBY',
  'of.lobbyWorking': 'working',
  'of.lobbyWaiting': 'need you',
  'of.lobbyRooms': { one: 'room', other: 'rooms' },
  'of.badgeAsk': 'NEEDS ANSWER',
  'of.badgeWait': 'YOUR TURN',
  'of.badgeSleep': 'ASLEEP',
  'of.session': 'Session',
  'of.chipAsk': 'Needs answer',
  'of.chipWait': 'Your turn',
  'of.rooms': { one: '{b} room', other: '{b} rooms' },
  'of.working': '{b} working',
  'of.waiting': '{b} waiting for you',
  'of.nobody': 'no one is waiting for you',
  'of.empty': 'No Claude Code sessions are open right now.',
  'of.subTip': 'subagent',
};

const dict = lang === 'tr' ? tr : en;
const plural = new Intl.PluralRules(lang);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function t(key, p) {
  let v = has(dict, key) ? dict[key] : en[key];
  if (v == null) return key;
  if (typeof v === 'function') return v(p || {});
  if (typeof v === 'object') v = v[plural.select(Number(p && p.n) || 0)] || v.other;
  return p ? v.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? String(p[k]) : m)) : v;
}

// ---------------------------------------------------------------- formatting

const nf = new Intl.NumberFormat(locale);
export const fmtNum = n => nf.format(n);
export const fmtPct = n => (lang === 'tr' ? `%${n}` : `${n}%`);
// Decimal separator: TR "1,2k" · EN "1.2k" (applied to toFixed output)
export const dec = s => (lang === 'tr' ? String(s).replace('.', ',') : String(s));
// Date → 'long' | 'short' | 'since' format
export function fmtDate(kind, date, extra) {
  return t('date.' + kind, { d: date.getDate(), m: date.getMonth(), w: date.getDay(), ...extra });
}

// ---------------------------------------------------------------- server text
// The server also sends a language-neutral `code` with most labels it synthesizes (see util.js actText/evText).
// A small map covers the few remaining fixed strings; transcript content (commands, file names, prompts) is left as is.
const SERVER_EN = {
  'İzleniyor': 'Monitoring',
  'Alt ajan': 'Subagent',
  'Soru': 'Question',
  'Plan onayı': 'Plan approval',
  'Görev listesi': 'Task list',
  'Uyanma planı': 'Wake-up plan',
  'Düşünüyor': 'Thinking',
  'Çalışıyor': 'Working',
  'Sıra sende': 'Your turn',
  'Bağlam sıkıştırıldı': 'Context compacted',
  'Sıkıştırma': 'Compaction',
  'Zamanlı görev': 'Scheduled task',
  'Görev': 'Task',
  'İstek': 'Prompt',
  'Bekleme': 'Waiting',
};
export function serverText(s) {
  if (!s || lang === 'tr') return s || '';
  if (has(SERVER_EN, s)) return SERVER_EN[s];
  const m = /^(\d+) alt ajan bekleniyor$/.exec(s);
  return m ? t('act.waitSubs', { n: Number(m[1]) }) : s;
}

// ---------------------------------------------------------------- static page

export function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-tail]').forEach(el => {
    const n = [...el.childNodes].reverse().find(x => x.nodeType === 3 && x.nodeValue.trim());
    if (n) n.nodeValue = t(el.dataset.i18nTail);
  });
}

function mountLangButton() {
  const b = document.getElementById('lang');
  if (!b || b.dataset.ready) return;
  b.dataset.ready = '1';
  const next = lang === 'tr' ? 'en' : 'tr';
  b.textContent = lang.toUpperCase();
  b.title = t('lang.tip', { cur: LANG_NAMES[lang], next: LANG_NAMES[next] });
  b.setAttribute('aria-label', b.title);
  b.addEventListener('click', () => setLang(next));
}

try {
  document.documentElement.lang = lang;
  applyDom();
  mountLangButton();
} catch { /* no DOM (e.g. in tests): skip silently */ }
