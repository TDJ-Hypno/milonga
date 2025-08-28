// === KONFIGURACJA BACKENDU (GAS Web App) ===
// PODMIEŃ na swój adres wdrożenia Web App (doPost zapisujący do Arkusza):
const SUBMIT_API = 'https://script.google.com/macros/s/AKfycbya_MHLx69_AhEukYVm0jQNMSOg1VG0G-xN6tD32_92fxWHzz1DzwEG57it3rPsWOErBw/exec';
const LINK_CHECK_API = SUBMIT_API; // jeśli używasz tego samego WebAppa

// --- toggles dla walidacji linku (tymczasowo wyłączone) ---
const REQUIRE_LINK = true; // jeśli true: pole Link musi być wypełnione
const VERIFY_LINK  = false; // jeśli true: sprawdzaj istnienie strony (GAS/HEAD/GET)

// === WALIDACJA / KONFIG DODATKOWA ===
// Jeśli chcesz faktycznie weryfikować adresy przez Google Geocoding API, ustaw USE_GEOCODING=true
// i wpisz klucz w GEOCODE_API_KEY (pamiętaj o ograniczeniach referrer).
const USE_GEOCODING   = false;
const GEOCODE_API_KEY = '';

// Krótki alias do wyświetlania komunikatów (korzysta z showMessage, jeśli jest w projekcie):
function msg(s) { (window.showMessage ? showMessage : alert)(s); }

// Zbuduj lokalny obiekt Date z "YYYY-MM-DD", hour(0-23), minute(0-59)
function toLocalDate(dateYMD, h, m) {
  if (!dateYMD) return null;
  const [Y, M, D] = dateYMD.split('-').map(x => parseInt(x, 10));
  if (!Y || !M || !D) return null;
  const hh = parseInt(h, 10), mm = parseInt(m, 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return new Date(Y, M - 1, D, hh, mm, 0, 0);
}

// Proste sprawdzenie adresu przez Google Geocoding (opcjonalne)
async function geocodeAddress(addr) {
  if (!USE_GEOCODING || !GEOCODE_API_KEY) return true; // bez geocodingu przepuszczamy
  const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${GEOCODE_API_KEY}&address=${encodeURIComponent(addr)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.results) && data.results.length > 0;
  } catch {
    return false;
  }
}

// Sprawdź czy URL istnieje (z uwzględnieniem CORS): true | false | 'unknown'
async function checkUrlExists(u) {
  if (!u) return true;
  // 1) spróbuj serwerowo przez GAS (bez CORS problemów)
  if (typeof LINK_CHECK_API === 'string' && LINK_CHECK_API) {
    try {
      const res = await fetch(`${LINK_CHECK_API}?action=checkUrl&u=${encodeURIComponent(u)}`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok === true) return !!data.exists;
      }
    } catch (_) { /* spadamy do fallbacku */ }
  }
  // 2) fallback: próba z przeglądarki (często blokowane przez CORS)
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
  } catch { return false; }

  try {
    const r = await fetch(u, { method: 'HEAD', mode: 'cors' });
    return r.ok;
  } catch {
    try {
      const r2 = await fetch(u, { method: 'GET', mode: 'cors' });
      return r2.ok;
    } catch {
      return 'unknown';
    }
  }
}

// === POMOCNIKI UI / FORMATOWANIE ===
const $id  = (x) => document.getElementById(x);
const pad2 = (n) => n.toString().padStart(2, '0');

// "YYYY-MM-DD HH:MM" (lub '' jeśli brak daty)
const makeDateTime = (d, h, m) => d ? `${d} ${pad2(h)}:${pad2(m)}:00` : '';

// Teksty podpowiedzi (po kliknięciu w nazwę pola)
const HINTS = {
  'Nazwa wydarzenia': 'Podaj pełną nazwę tak, by uczestnicy łatwo rozpoznali wydarzenie.',
  'Adres': 'Pełny adres (ulica, numer, miasto). Dzięki temu łatwiej wyznaczyć trasę.',
  'Dzień tygodnia': 'Zaznacz, jeśli wydarzenie jest cykliczne (np. w każdą środę). Zostaw puste dla jednorazowych.',
  'Data od': 'Data rozpoczęcia. Domyślnie ustawiamy bieżącą datę.',
  'Godzina od': 'Godzina rozpoczęcia. Minuty: 00/10/20/30/40/50.',
  'Data do': 'Data zakończenia (zwykle ta sama co „Data od”).',
  'Godzina do': 'Godzina zakończenia. Minuty: 00/10/20/30/40/50 oraz 59 (do pełnej).',
  'Parkietowe': 'Wpisz cenę biletu lub „free”.',
  'Organizator': 'Nazwa organizatora lub szkoły.',
  'TDj': 'Imię/nick DJ-a (jeśli znany).',
  'Typ muzyki': 'Np. klasyczna / nuevo / alternatywna / mix.',
  'Link': 'Link do wydarzenia/strony (FB, WWW itp.).',
  'Informacja': 'Krótki opis: ważne szczegóły, dress code, parking, zapisy itd.'
};


// === BACKEND: wysyłka do Apps Script ===
async function submitEvent(payload) {
  const res = await fetch(SUBMIT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // unika preflightu
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!data || data.ok !== true) throw new Error('Bad response');
  return true;
}


// === ZBIERANIE DANYCH Z FORMULARZA ===
function getPayload() {
  const name = $id('f_name').value.trim();
  const addr = $id('f_addr').value.trim();

  const dowRaw = $id('f_dow').value.trim();
  const dow    = dowRaw ? dowRaw.toLocaleLowerCase('pl-PL') : '';

  const fromD = $id('f_from_d').value;
  const fromH = +$id('f_from_h').value;
  const fromM = +$id('f_from_m').value;

  const toD   = $id('f_to_d').value;
  const toH   = +$id('f_to_h').value;
  const toM   = +$id('f_to_m').value;

  const payload = {
    action: 'submitEvent',

    // Klucze zgodne z kolumnami w Arkuszu:
    'Nazwa':           name,
    'Adres':           addr,
    'Dzien_tygodnia':  dow || '',
    'Data od':         makeDateTime(fromD, fromH, fromM),
    'Data do':         makeDateTime(toD,   toH,   toM),
    'Parkietowe':      $id('f_fee').value.trim(),
    'Organizator':     $id('f_org').value.trim(),
    'TDJ':             $id('f_tdj').value.trim(),
    'Typ muzyki':      $id('f_music').value.trim(),
    'Link':            $id('f_link').value.trim(),
    'Informacje':      $id('f_info').value.trim(),

    // domyślne/techniczne:
    'Klikniete': 0,
    'Trasa':     0,
    'Kalendarz': 0,
    'Opłacone':  '' // Ty ręcznie ustawiasz „Tak” po weryfikacji
  };

  return payload;
}


// === WALIDACJA PRZED WYSYŁKĄ ===
async function validateBeforeSubmit() {
  // surowe wartości
  const name = $id('f_name').value.trim();
  const addr = $id('f_addr').value.trim();

  const fromD = $id('f_from_d').value;
  const fromH = $id('f_from_h').value;
  const fromM = $id('f_from_m').value;

  const toD   = $id('f_to_d').value;
  const toH   = $id('f_to_h').value;
  const toM   = $id('f_to_m').value;

  // 1) Nazwa min. 10 znaków
  if (name.length < 10) {
    msg('Podaj pełną nazwę wydarzenia (minimum 10 znaków).');
    return { ok:false };
  }

  // 2) Adres — sanity check + (opcjonalnie) geocoding
  if (addr.length < 5 || !/[a-zA-ZĄąĆćĘęŁłŃńÓóŚśŹźŻż]/.test(addr)) {
    msg('Adres wygląda na niepoprawny. Podaj pełny adres (ulica, numer, miasto).');
    return { ok:false };
  }
  const geoOK = await geocodeAddress(addr);
  if (geoOK === false) {
    msg('Nie udało się potwierdzić adresu w geokoderze Google. Sprawdź adres.');
    return { ok:false };
  }

  // 3) Daty/godziny
  const start = toLocalDate(fromD, fromH, fromM);
  const end   = toLocalDate(toD,   toH,   toM);
  if (!start || !end) {
    msg('Uzupełnij poprawnie datę i godzinę rozpoczęcia oraz zakończenia.');
    return { ok:false };
  }

  const now = new Date();
  if (start < now) {
    const go = confirm('Start wydarzenia jest w przeszłości. Czy na pewno chcesz wysłać?');
    if (!go) return { ok:false };
  }

  if (end < start) {
    msg('Data i godzina zakończenia nie mogą być wcześniejsze niż rozpoczęcia.');
    return { ok:false };
  }

  const TWO_H = 2 * 60 * 60 * 1000;
  if ((end - start) < TWO_H) {
    msg('Wydarzenie nie może być krótsze niż 2 godziny.');
    return { ok:false };
  }

  const FOUR_D = 4 * 24 * 60 * 60 * 1000;
  if ((end - start) > FOUR_D) {
    const go = confirm('Wydarzenie trwa dłużej niż 4 dni. Czy na pewno tak ma być?');
    if (!go) return { ok:false };
  }

  // 6) Link — wymagany + format + próba weryfikacji (sterowane flagami powyżej)
  let link = $id('f_link').value.trim();
  
  // wymaganie pola – tylko jeśli włączone
  if (REQUIRE_LINK && !link) {
    msg('Pole „Link do wydarzenia/strony” jest wymagane.');
    return { ok:false };
  }
  
  // jeśli coś wpisano, to ewentualnie dołóż https:// (nawet gdy weryfikacja wyłączona)
  if (link && !/^https?:\/\//i.test(link)) {
    link = 'https://' + link;
    $id('f_link').value = link; // ujednolić payload
  }
  
  // faktyczna weryfikacja istnienia strony – tylko jeśli włączona
  if (VERIFY_LINK && link) {
    const exists = await checkUrlExists(link);
    if (exists === false) {
      msg('Podany link wygląda na nieistniejący. Sprawdź adres strony.');
      return { ok:false };
    }
    if (exists === 'unknown') {
      const go = confirm('Nie udało się potwierdzić istnienia strony (CORS). Czy mimo to wysłać?');
      if (!go) return { ok:false };
    }
  }
    return { ok:true };
} 

// === UI / LOGIKA FORMULARZA ===
function fillSelects() {
  // godziny 00..23 (wyświetlane dwucyfrowo, wartości 0..23)
  const hours = [...Array(24)].map((_, i) => i);
  const sFH = $id('f_from_h'), sFM = $id('f_from_m');
  const sTH = $id('f_to_h'),   sTM = $id('f_to_m');

  sFH.innerHTML = hours.map(h => `<option value="${h}">${pad2(h)}</option>`).join('');
  sTH.innerHTML = hours.map(h => `<option value="${h}">${pad2(h)}</option>`).join('');

  // minuty: od — 00,10,20,30,40,50; do — 00,10,20,30,40,50,59
  const minsFrom = [0, 10, 20, 30, 40, 50];
  const minsTo   = [0, 10, 20, 30, 40, 50, 59];

  sFM.innerHTML = minsFrom.map(m => `<option value="${m}">${pad2(m)}</option>`).join('');
  sTM.innerHTML = minsTo  .map(m => `<option value="${m}">${pad2(m)}</option>`).join('');
}

function setDefaults() {
  // Domyślna data: dziś
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm   = pad2(today.getMonth()+1);
  const dd   = pad2(today.getDate());
  $id('f_from_d').value = `${yyyy}-${mm}-${dd}`;
  $id('f_to_d').value   = `${yyyy}-${mm}-${dd}`;

  // Domyślne godziny
  $id('f_from_h').value = '20'; $id('f_from_m').value = '0';
  $id('f_to_h').value   = '23'; $id('f_to_m').value   = '59';
}

function openSubmitModal() {
  $id('submitModal').style.display = 'block';
}
function closeSubmitModal() {
  $id('submitModal').style.display = 'none';
}

function openHint(title) {
  $id('hintTitle').textContent = title;
  $id('hintText').textContent  = HINTS[title] || '';
  $id('hintModal').style.display = 'block';
}
function closeHint() {
  $id('hintModal').style.display = 'none';
}

function clearForm() {
  $id('f_name').value = '';
  $id('f_addr').value = '';
  $id('f_dow').value  = '';
  setDefaults();
  $id('f_fee').value = '';
  $id('f_org').value = '';
  $id('f_tdj').value = '';
  $id('f_music').value = '';
  $id('f_link').value = '';
  $id('f_info').value = '';
}

function bindForm() {
  // Koperta (panel): obsłuż click + touchend (Android)
  const emailPanel = document.getElementById('emailPanel');
  if (emailPanel) {
    const openForm = (e) => {
      e.preventDefault();      // blokuje „ghost click” po dotyku
      e.stopPropagation();     // nie pozwala klikowi bąbelkować wyżej
      openSubmitModal();
    };
    emailPanel.addEventListener('click', openForm);
    emailPanel.addEventListener('touchend', openForm, { passive: false });
  }


  // Przyciski modala
  $id('submitCloseBtn').addEventListener('click', closeSubmitModal);
  $id('submitCancelBtn').addEventListener('click', closeSubmitModal);
  $id('hintCloseBtn').addEventListener('click', closeHint);

  // Podpowiedzi (kliknięcie nazwy pola)
  document.querySelectorAll('#submitModal a.hint').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      openHint(a.dataset.name || 'Podpowiedź');
    });
  });

  // Wysyłka
  $id('submitSendBtn').addEventListener('click', async ()=>{
    const v = await validateBeforeSubmit();
    if (!v.ok) return;
    
    const payload = getPayload();

    // Blokada przycisku na czas wysyłki
    const btn = $id('submitSendBtn');
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Wysyłanie…';

    try {
      await submitEvent(payload);
      (window.showMessage ? showMessage : alert)(
        'Dziękujemy! Zgłoszenie zapisane — po weryfikacji pojawi się na mapie.'
      );
      closeSubmitModal();
      clearForm();
    } catch(e) {
      console.error(e);
      (window.showMessage ? showMessage : alert)(
        'Nie udało się zapisać. Spróbuj ponownie.'
      );
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  });

  // Inicjalizacja pól
  fillSelects();
  setDefaults();

  // Udostępnij otwieranie modala dla onclick w index.html
  window.openSubmitModal = openSubmitModal;
}

// Start po załadowaniu DOM
document.addEventListener('DOMContentLoaded', bindForm);