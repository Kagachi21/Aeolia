/* Pure probe: Windows toast decoding. No Electron, no live database.
   Run: node _probe-toast-parse.js */
const n = require('./dist/main/notifications.js');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + detail}`);
};

const XML = '<toast><visual><binding template="ToastText02">'
  + '<text id="1">Iseki Security</text>'
  + '<text id="2">Adtyafarid: shift selesai &amp; alarm &lt;aktif&gt;</text>'
  + '</binding></visual></toast>';

// 1. A raw XML string passes straight through.
check('decodePayload keeps raw XML', n.decodePayload(XML) === XML);

// 2. The comma-separated byte string the database actually returns.
const csv = Array.from(Buffer.from(XML, 'utf8')).join(',');
check('decodePayload decodes CSV of bytes', n.decodePayload(csv) === XML,
  `${csv.slice(0, 24)}...`);

// 3. A real Buffer and a Uint8Array both decode.
check('decodePayload decodes Buffer', n.decodePayload(Buffer.from(XML, 'utf8')) === XML);
check('decodePayload decodes Uint8Array',
  n.decodePayload(new Uint8Array(Buffer.from(XML, 'utf8'))) === XML);

// 4. Junk never throws.
check('decodePayload is total', n.decodePayload(null) === ''
  && n.decodePayload(undefined) === ''
  && n.decodePayload({}) === '');

// 5. ToastText02 -> title then body, entities unescaped, tags stripped.
const parsed = n.parseToast(XML);
check('parseToast title', parsed && parsed.title === 'Iseki Security', parsed && parsed.title);
check('parseToast body unescapes entities',
  parsed && parsed.body === 'Adtyafarid: shift selesai & alarm <aktif>',
  parsed && parsed.body);

// 6. A badge-only toast has no text nodes and must be dropped, not shown blank.
check('parseToast drops empty toasts', n.parseToast('<toast><visual><binding template="ToastGeneric"/></visual></toast>') === null);
check('parseToast drops non-XML', n.parseToast('badge value="72"/>') === null);

// 7. App identity.
check('friendlyApp WhatsApp', n.friendlyApp('5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App') === 'WhatsApp');
check('friendlyApp WorkBuddy', n.friendlyApp('WorkBuddy.WorkBuddyAI') === 'WorkBuddy');
check('friendlyApp Windows broker', n.friendlyApp('Microsoft.AAD.BrokerPlugin_cw5n1h2txyewy!App') === 'Windows');
check('friendlyApp falls back to a word',
  n.friendlyApp('Contoso.Thing_abc!App') === 'Thing',
  n.friendlyApp('Contoso.Thing_abc!App'));

// 8. FILETIME -> epoch ms. 134392295027547510 is a real row from this machine.
const ms = n.filetimeToMs('134392295027547510');
const iso = new Date(ms).toISOString();
check('filetimeToMs lands in 2026', iso.startsWith('2026-'), iso);
check('filetimeToMs rejects junk', n.filetimeToMs(0) === 0 && n.filetimeToMs('x') === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
