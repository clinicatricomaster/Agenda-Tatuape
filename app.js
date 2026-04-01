// --- FIREBASE V9 MODULAR IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, updateDoc, getDocs, query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// ─── CONFIGURAÇÃO FIREBASE ────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyCn9b-Ncj5y5JQBLgutNTpgYKWTON15jgc",
    authDomain: "agenda-97604.firebaseapp.com",
    projectId: "agenda-97604",
    storageBucket: "agenda-97604.appspot.com",
    messagingSenderId: "432645254067",
    appId: "1:432645254067:web:539fa179c923ed887939c6"
};
const firebaseApp = initializeApp(firebaseConfig);
const db   = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const COLUMN_TITLES = ['Médico 1', 'Médico 2', 'Tratamento 1', 'Tratamento 2', 'Tratamento 3'];
const CONSULTATION_TYPES = {
    '': '', 'Consulta': 'C', 'Nova Consulta': 'NC',
    'Retorno Presencial': 'RP', 'Retorno Online': 'RO',
    'Reavaliação Final': 'RVF', 'Reavaliação Meio': 'RVM'
};
const RETURN_TYPES = ['Retorno Presencial', 'Retorno Online'];
const CONSULTATION_DURATIONS = {
    'Consulta': 1.0, 'Nova Consulta': 1.0, 'Retorno Presencial': 0.5,
    'Retorno Online': 0.5, 'Reavaliação Final': 1.0, 'Reavaliação Meio': 0.5, '': 1.0
};
const UNIT_COLORS = { 'Tatuape': '#0D542B', 'Santana': '#1e40af' }; // Tatuapé=verde, Santana=azul
const UNIT_NAMES  = { 'Tatuape': 'Unidade Tatuapé', 'Santana': 'Unidade Santana' };
const AGENDA_START = 8;
const AGENDA_END   = 19;

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
let currentUser          = null;
let unsubscribeListeners = [];
let currentReportData    = [];
// Unidade ativa — única fonte da verdade no JS.
// Sempre atualizada por changeUnit() antes de qualquer operação.
let currentUnit = localStorage.getItem('tm_last_unit') || 'Tatuape';
// Valida o valor salvo — se inválido, usa padrão
if (!UNIT_NAMES[currentUnit]) currentUnit = 'Tatuape';
let availableTags        = ['Medicação', 'Reagendar', 'Agendar Próximo Mês', 'Financeiro / Nota', 'Geral'];
let professionals        = { medicos: [], enfermagem: [] };
let patients             = [];
let appointments         = {};
let medications          = [];
let procedures           = [];
let observations         = [];

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
window.openModal  = (id) => document.getElementById(id)?.classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id)?.classList.add('hidden');

window.formatPhoneNumber = (v) => {
    if (!v) return '';
    v = v.replace(/\D/g, '').substring(0, 11);
    if (v.length > 10) return v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (v.length > 6)  return v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    if (v.length > 2)  return v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
    return v.replace(/(\d*)/, '($1');
};

function showNotification(type, message, duration = 5000) {
    document.getElementById('global-notification')?.remove();
    const classes = { success: 'notification-success', error: 'notification-error', warning: 'notification-warning', info: 'notification-info' };
    const n = document.createElement('div');
    n.id = 'global-notification';
    n.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${classes[type] || classes.info} fade-in`;
    n.innerHTML = `<div class="flex items-center justify-between"><span>${message}</span><button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-lg">&times;</button></div>`;
    document.body.appendChild(n);
    if (duration > 0) setTimeout(() => { if (n.parentElement) n.remove(); }, duration);
}

const toTitleCase = (str) => {
    if (!str) return '';
    // Usa split por espaço para preservar acentos corretamente
    return str.trim().split(/\s+/).map(word =>
        word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''
    ).join(' ');
};
const getSelectedDate = () => document.getElementById('date-picker')?.value || '';
const formatDateDDMMYY = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y.slice(-2)}`; };

function getTagColor(tagName) {
    const c = [
        {bg:'#FEF3C7',t:'#92400E'},{bg:'#DBEAFE',t:'#1E40AF'},{bg:'#D1FAE5',t:'#065F46'},
        {bg:'#FCE7F3',t:'#9D174D'},{bg:'#EDE9FE',t:'#5B21B6'},{bg:'#FFE4E6',t:'#BE123C'},
        {bg:'#DCFCE7',t:'#166534'},{bg:'#FEF7CD',t:'#854D0E'},{bg:'#E0E7FF',t:'#3730A3'},
        {bg:'#F0FDF4',t:'#15803D'}
    ];
    if (!tagName) return c[0];
    let h = 0;
    for (let i = 0; i < tagName.length; i++) h = tagName.charCodeAt(i) + ((h << 5) - h);
    return c[Math.abs(h) % c.length];
}

function loadTagsConfig() {
    try { const s = localStorage.getItem('tricomaster_tags'); if (s) availableTags = JSON.parse(s); } catch(e) {}
    renderTagsSummary();
}
function saveTagsConfig() {
    localStorage.setItem('tricomaster_tags', JSON.stringify(availableTags));
    renderTagsSummary();
}

// ─── TROCA DE UNIDADE ─────────────────────────────────────────────────────────
window.changeUnit = (newUnit) => {
    if (currentUnit === newUnit || !UNIT_NAMES[newUnit]) return;
    // 1. Atualiza a variável JS — fonte da verdade
    currentUnit = newUnit;
    localStorage.setItem('tm_last_unit', newUnit);
    // 2. Sincroniza o select visual
    const sel = document.getElementById('unit-select');
    if (sel) sel.value = newUnit;
    // 3. Atualiza cor do cabeçalho imediatamente
    renderAgendaHeader();
    // 4. Limpa agendamentos da unidade anterior e recarrega os da nova
    appointments = {};
    renderAgendaContent(); // mostra vazio enquanto carrega
    setupRealtimeListeners(); // reinicia o listener com nova unidade
    showNotification('info', `Trocado para ${UNIT_NAMES[newUnit]}`);
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
    if (user) {
        currentUser = user;
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        // Sincroniza currentUnit com o select (que foi preenchido pelo script inline do HTML)
        const sel = document.getElementById('unit-select');
        if (sel && sel.value && UNIT_NAMES[sel.value]) currentUnit = sel.value;
        renderAgendaHeader();
        renderAgenda();          // mostra data e header imediatamente
        setupRealtimeListeners(); // carrega dados em tempo real
        loadTagsConfig();
    } else {
        currentUser  = null;
        appointments = {};
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('login-container').classList.remove('hidden');
        unsubscribeListeners.forEach(u => u());
        unsubscribeListeners = [];
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const dp = document.getElementById('date-picker');
    if (dp) {
        dp.value = new Date().toISOString().split('T')[0];
        dp.addEventListener('change', renderAgenda);
    }
    const tp = document.getElementById('toggle-password');
    const pi = document.getElementById('password');
    if (tp && pi) {
        tp.addEventListener('click', function () {
            const t = pi.getAttribute('type') === 'password' ? 'text' : 'password';
            pi.setAttribute('type', t);
            this.querySelector('svg').innerHTML = t === 'password'
                ? '<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'
                : '<path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>';
        });
    }
    document.getElementById('login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const le = document.getElementById('login-error');
        le.classList.add('hidden');
        signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value)
            .catch(() => { le.textContent = 'Email ou senha inválidos.'; le.classList.remove('hidden'); });
    });
    document.getElementById('logout-button')?.addEventListener('click', () => signOut(auth));
});

// ─── LISTENERS TEMPO REAL ─────────────────────────────────────────────────────
// REGRA FUNDAMENTAL: UM ÚNICO listener para appointments, SEM filtro no Firestore.
// Filtragem por unidade é local. Isso elimina race conditions e garante que
// nenhum agendamento desapareça independente de como os dados foram salvos.
function setupRealtimeListeners() {
    unsubscribeListeners.forEach(u => u());
    unsubscribeListeners = [];

    const colecoes = [
        { name: 'professionals', q: query(collection(db, 'professionals'), orderBy('name')) },
        { name: 'medications',   q: query(collection(db, 'medications'),   orderBy('name')) },
        { name: 'procedures',    q: query(collection(db, 'procedures'),    orderBy('name')) },
        { name: 'patients',      q: collection(db, 'patients') },
        { name: 'observations',  q: query(collection(db, 'observations'),  orderBy('createdAt', 'desc')) },
    ];

    colecoes.forEach(({ name, q }) => {
        unsubscribeListeners.push(
            onSnapshot(q,
                snap => handleSimpleSnapshot(name, snap),
                err  => { console.error(`Erro em ${name}:`, err); showNotification('error', `Erro ao carregar ${name}.`); }
            )
        );
    });

    // Listener único de agendamentos — sem filtro no Firestore para evitar race conditions.
    // Regra de filtro LOCAL por unidade:
    //   - unit definida e igual à unidade atual  → MOSTRA
    //   - unit definida e DIFERENTE               → ESCONDE (corrige cruzamento entre unidades)
    //   - sem unit (legado)                       → migra para Tatuape e mostra só lá
    unsubscribeListeners.push(
        onSnapshot(
            collection(db, 'appointments'),
            snap => {
                const novo = {};
                snap.docs.forEach(d => {
                    const a = { id: d.id, ...d.data() };

                    // Ignora excluídos
                    if (a.status === 'Excluído') return;

                    if (a.unit) {
                        // Tem unidade definida: filtra estritamente
                        if (a.unit === currentUnit) novo[d.id] = a;
                    } else {
                        // Documento legado sem campo 'unit': mostra em Tatuapé
                        if (currentUnit === 'Tatuape') novo[d.id] = a;
                        // Migra UMA VEZ — só se realmente não tiver o campo
                        if (!d.data().hasOwnProperty('unit')) {
                            setDoc(doc(db, 'appointments', d.id), { unit: 'Tatuape' }, { merge: true })
                                .catch(err => console.warn('Migração unit falhou:', d.id, err));
                        }
                    }
                });
                appointments = novo;
                renderAgendaContent();
            },
            err => {
                console.error('Erro ao carregar agendamentos:', err);
                showNotification('error', 'Erro ao carregar agendamentos. Verifique sua conexão.');
            }
        )
    );
}

function handleSimpleSnapshot(coll, snap) {
    switch (coll) {
        case 'professionals':
            professionals = { medicos: [], enfermagem: [] };
            snap.docs.forEach(d => {
                const a = { id: d.id, ...d.data() };
                (a.role === 'medicos' ? professionals.medicos : professionals.enfermagem).push(a);
            });
            break;
        case 'medications':
            medications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            break;
        case 'procedures':
            procedures = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            break;
        case 'patients':
            patients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            break;
        case 'observations':
            observations = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date() }));
            renderTagsSummary();
            if (!document.getElementById('modal-lista-observacoes')?.classList.contains('hidden')) applyObservationFilters();
            break;
    }
}

// ─── RENDERIZAÇÃO DA AGENDA ───────────────────────────────────────────────────
function renderAgenda() {
    if (!currentUser) return;
    updateDateDisplay();
    renderAgendaHeader();
    renderAgendaContent();
}

function renderAgendaHeader() {
    const c = document.getElementById('agenda-header-titles');
    if (!c) return;
    const color = UNIT_COLORS[currentUnit] || UNIT_COLORS['Tatuape'];
    c.innerHTML = `<div class="grid-cell h-[50px] font-bold flex items-center justify-center p-2 text-center text-sm" style="background-color:${color};color:white;">Horário</div>`;
    COLUMN_TITLES.forEach(t =>
        c.insertAdjacentHTML('beforeend', `<div class="grid-cell h-[50px] font-bold flex items-center justify-center p-2 text-center text-sm" style="background-color:${color};color:white;">${t}</div>`)
    );
}

function renderAgendaContent() {
    const c = document.getElementById('agenda-grid-content');
    if (!c) return;
    c.innerHTML = '';
    const date = getSelectedDate();
    if (!date) { c.innerHTML = '<div class="col-span-6 p-4 text-center text-gray-500">Selecione uma data</div>'; return; }
    generateTimeSlots().forEach(slotTime => {
        const row = document.createElement('div');
        row.className = 'contents time-row';
        const tc = document.createElement('div');
        tc.className = 'grid-cell time-slot text-sm';
        tc.textContent = slotTime;
        row.appendChild(tc);
        COLUMN_TITLES.forEach(col => row.appendChild(createColumnCell(col, slotTime, date)));
        c.appendChild(row);
    });
}

function generateTimeSlots() {
    const slots = [];
    for (let h = AGENDA_START; h <= AGENDA_END; h++) {
        slots.push(`${String(h).padStart(2,'0')}:00`);
        slots.push(`${String(h).padStart(2,'0')}:30`);
    }
    return slots;
}

function updateDateDisplay() {
    const ds   = getSelectedDate();
    const disp = document.getElementById('current-date-display');
    if (!ds || !disp) return;
    disp.innerText = new Intl.DateTimeFormat('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' }).format(new Date(ds + 'T03:00:00'));
}

// ─── CÉLULAS DA GRADE ─────────────────────────────────────────────────────────
function createColumnCell(column, slotTime, selectedDate) {
    const [h, mStr] = slotTime.split(':');
    const m   = parseInt(mStr, 10);
    const sub1 = slotTime;                          // :00 ou :30
    const sub2 = `${h}:${m === 0 ? '15' : '45'}`; // :15 ou :45

    const appt1 = appointments[`${selectedDate}-${column}-${sub1}`];
    const appt2 = appointments[`${selectedDate}-${column}-${sub2}`];
    const isFull = appt1 && !RETURN_TYPES.includes(appt1.consultationType);

    const content = document.createElement('div');
    content.className = 'grid-cell-content';

    if (isFull) {
        content.innerHTML = createAppointmentCard(appt1, 'full', slotTime);
    } else if (appt1 && appt2) {
        content.innerHTML  = createAppointmentCard(appt1, 'half', slotTime);
        content.innerHTML += createAppointmentCard(appt2, 'half', slotTime);
    } else if (appt1) {
        content.innerHTML  = createAppointmentCard(appt1, 'half', slotTime);
        content.innerHTML += createPlaceholderCard(column, sub2, slotTime, appt1.professionalName);
    } else if (appt2) {
        content.innerHTML  = createPlaceholderCard(column, sub1, slotTime, appt2.professionalName);
        content.innerHTML += createAppointmentCard(appt2, 'half', slotTime);
    } else {
        content.onclick = () => window.openAppointmentModal(column, slotTime);
    }

    const cell = document.createElement('div');
    cell.className = 'grid-cell border-t border-l border-gray-200';
    cell.appendChild(content);
    return cell;
}

function createAppointmentCard(appt, sizeClass, baseTime) {
    if (!appt) return '';
    const isMedico = appt.column?.startsWith('Médico');
    const type     = appt.consultationType || '';
    let cardClass  = '';

    if (appt.status === 'Confirmada') {
        if (isMedico) {
            if (['Consulta','Nova Consulta'].includes(type)) cardClass = 'medico-confirmada-consulta';
            else if (RETURN_TYPES.includes(type))           cardClass = 'medico-confirmada-retorno';
            else if (type.startsWith('Reavaliação'))        cardClass = 'medico-confirmada-reavaliacao';
            else                                            cardClass = 'medico-confirmada-consulta';
        } else { cardClass = 'profissional-confirmada'; }
    } else {
        const map = { Agendada:'status-agendada', Faltou:'status-faltou', Aberta:'status-aberta', Fechada:'status-fechada' };
        cardClass = map[appt.status] || 'status-fechada';
    }

    let content = '';
    if (appt.status === 'Fechada' || appt.status === 'Aberta') {
        content = `<div class="flex items-center justify-center h-full p-2"><strong class="text-xs truncate">${appt.observation || appt.status}</strong></div>`;
    } else {
        const phone   = appt.patientPhone ? window.formatPhoneNumber(appt.patientPhone) : '';
        const items   = [...(appt.procedures || []), appt.medication].filter(Boolean).join(' • ');
        const obsIcon = appt.observation
            ? `<svg class="observation-indicator" viewBox="0 0 20 20" fill="currentColor" title="${appt.observation}"><path fill-rule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM9 9a1 1 0 11-2 0 1 1 0 012 0zm4 0a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"/></svg>` : '';
        const line1 = isMedico
            ? `<div class="text-xs flex justify-between items-center w-full"><span class="truncate flex items-center"><span class="font-bold uppercase">${type}</span><span class="mx-2 font-light text-gray-400">|</span><span>${appt.professionalName || ''}</span></span><span class="font-bold shrink-0 ml-2">${appt.time}</span></div>`
            : `<div class="text-xs font-bold flex justify-between items-center w-full"><span class="truncate">${appt.professionalName || appt.procedures?.[0] || ''}</span><span class="font-bold shrink-0 ml-2">${appt.time}</span></div>`;
        const line2 = `<div class="text-sm my-1"><span class="font-bold">${appt.patientName || 'Sem nome'}</span>${phone ? `<span class="font-bold ml-2">${phone}</span>` : ''}</div>`;
        const line3 = `<div class="text-xs text-inherit opacity-80 flex items-center gap-2 truncate"><span>${items}</span>${obsIcon}</div>`;
        content = `<div class="flex-grow flex flex-col justify-center overflow-hidden p-2">${line1}${line2}${line3}</div>`;
    }
    // Escapa o id para prevenir quebra de HTML no onclick (ids podem ter caracteres especiais)
    const safeId = appt.id.replace(/'/g, "\'");
    const safeCol = (appt.column || '').replace(/'/g, "\'");
    return `<div onclick="event.stopPropagation();window.openAppointmentModal('${safeCol}','${baseTime}','${safeId}')" class="appointment-card appointment-card-${sizeClass} ${cardClass}">${content}</div>`;
}

function createPlaceholderCard(column, subTime, baseTime, profName = '') {
    return `<div class="placeholder-card" onclick="event.stopPropagation();window.openAppointmentModal('${column}','${baseTime}',null,'${profName}','Retorno Presencial','${subTime}')"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg></div>`;
}

// ─── MODAL DE AGENDAMENTO ─────────────────────────────────────────────────────
window.openAppointmentModal = (col, slotTime, id = null, profNameToPreload = '', typeToPreload = '', timeToBook = '') => {
    const appt   = id ? appointments[id] : null;
    const isMed  = col.startsWith('Médico');
    const pLabel = isMed ? 'Médico' : 'Profissional';
    let audit = '';
    if (appt?.lastModifiedBy) {
        const d = appt.lastModifiedAt?.toDate?.() || new Date();
        audit = `<p class="text-xs text-gray-400 mt-4 text-center">Última modificação: ${appt.lastModifiedBy} em ${d.toLocaleString('pt-BR')}</p>`;
    }

    document.getElementById('modal-agendamento').innerHTML = `
    <div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-2xl fade-in max-h-[95vh] overflow-y-auto" role="dialog">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold text-gray-800">${appt ? 'Editar' : 'Novo'} Agendamento</h2>
        <select id="appointment-status" class="form-input !w-auto !py-2">
          <option value="Agendada">Agendada</option><option value="Confirmada">Confirmada</option>
          <option value="Faltou">Faltou</option><option value="Aberta">Aberta</option><option value="Fechada">Fechada</option>
        </select>
      </div>
      <form id="appointment-form">
        <input type="hidden" id="appointment-id"        value="${id || ''}">
        <input type="hidden" id="appointment-column"    value="${col}">
        <input type="hidden" id="appointment-base-time" value="${slotTime}">
        <div id="block-until-container" class="hidden">
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div><label for="block-until-time" class="form-label">Bloquear/Desbloquear até</label><select id="block-until-time" class="form-input"></select></div>
            <div class="flex items-end"><button type="button" id="unblock-button" class="btn btn-secondary w-full">Desbloquear até</button></div>
          </div>
        </div>
        <div id="patient-info-container">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div class="relative">
              <label for="patient-name" class="form-label">Nome Paciente</label>
              <input type="text" id="patient-name" class="form-input" required autocomplete="off">
              <div id="patient-search-results" class="absolute z-10 w-full bg-white border mt-1 rounded-md shadow-lg hidden max-h-48 overflow-y-auto"></div>
            </div>
            <div><label for="patient-phone" class="form-label">Telefone</label><input type="tel" id="patient-phone" class="form-input" maxlength="15"></div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div><label for="appointment-professional" class="form-label">${pLabel}</label><select id="appointment-professional" class="form-input"></select></div>
            <div><label for="appointment-consultation-type" class="form-label">Tipo Consulta</label><select id="appointment-consultation-type" class="form-input" ${!isMed ? 'disabled' : ''}></select></div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div><label class="form-label">Procedimentos</label><div id="procedures-checkbox-container" class="grid grid-cols-2 gap-2 p-3 border rounded-md max-h-40 overflow-y-auto bg-white"></div></div>
            <div><label for="appointment-medication" class="form-label">Medicação</label><select id="appointment-medication" class="form-input"></select></div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div><label for="appointment-time" class="form-label">Horário</label><select id="appointment-time" class="form-input"></select></div>
            <div id="return-info" class="hidden"><label class="form-label">Info</label><p class="text-sm text-gray-600 mt-2">Retornos usam 15 min. Cada slot de 30 min pode ter 2 retornos.</p></div>
          </div>
        </div>
        <div class="mt-4"><label for="observation" class="form-label">Observação</label><textarea id="observation" rows="3" class="form-input"></textarea></div>
        <div class="flex justify-between items-center mt-6">
          <button type="button" id="delete-button" class="text-red-600 font-semibold hover:text-red-800 transition ${!id ? 'hidden' : ''}">Excluir</button>
          <div class="flex gap-4">
            <button type="button" id="cancel-button" class="btn btn-secondary">Cancelar</button>
            <button type="submit" class="btn btn-primary">Salvar</button>
          </div>
        </div>
        ${audit}
      </form>
    </div>`;

    document.getElementById('appointment-form').onsubmit  = async (e) => {
        const btn = document.querySelector('#appointment-form button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
        await saveAppointment(e);
        if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
    };
    document.getElementById('delete-button').onclick      = deleteAppointment;
    document.getElementById('cancel-button').onclick      = () => closeModal('modal-agendamento');
    document.getElementById('unblock-button').onclick     = unblockSlots;
    document.getElementById('appointment-status').addEventListener('change', handleStatusChange);
    document.getElementById('appointment-consultation-type').addEventListener('change', handleConsultationTypeChange);
    document.getElementById('patient-phone').addEventListener('input', e => { e.target.value = window.formatPhoneNumber(e.target.value); });
    document.getElementById('patient-name').addEventListener('input', showPatientSearch);

    populateModalDropdowns(col, slotTime);

    if (appt) {
        document.getElementById('appointment-status').value            = appt.status || 'Agendada';
        document.getElementById('patient-name').value                  = appt.patientName || '';
        document.getElementById('patient-phone').value                 = window.formatPhoneNumber(appt.patientPhone || '');
        document.getElementById('appointment-professional').value      = appt.professionalName || '';
        document.getElementById('appointment-consultation-type').value = appt.consultationType || '';
        document.getElementById('appointment-medication').value        = appt.medication || '';
        document.getElementById('observation').value                   = appt.observation || '';
        document.getElementById('appointment-time').value              = appt.time || slotTime;
        (appt.procedures || []).forEach(p => {
            const cb = document.querySelector(`input[name="procedures"][value="${p}"]`);
            if (cb) cb.checked = true;
        });
    } else {
        if (profNameToPreload) document.getElementById('appointment-professional').value = profNameToPreload;
        if (typeToPreload)     document.getElementById('appointment-consultation-type').value = typeToPreload;
    }

    handleConsultationTypeChange();
    if (timeToBook) document.getElementById('appointment-time').value = timeToBook;
    handleStatusChange();
    openModal('modal-agendamento');
};

function populateModalDropdowns(col, baseTime) {
    const profList = col.startsWith('Médico') ? professionals.medicos
        : col === 'Tratamento 3' ? [...professionals.medicos, ...professionals.enfermagem]
        : professionals.enfermagem;

    document.getElementById('appointment-professional').innerHTML =
        '<option value=""></option>' + profList.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    document.getElementById('appointment-consultation-type').innerHTML =
        Object.keys(CONSULTATION_TYPES).map(k => `<option value="${k}">${k}</option>`).join('');
    document.getElementById('appointment-medication').innerHTML =
        '<option value=""></option>' + medications.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    document.getElementById('procedures-checkbox-container').innerHTML =
        procedures.map(p => `<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" name="procedures" value="${p.name}" class="rounded"> ${p.name}</label>`).join('');

    let [bh, bm] = baseTime.split(':').map(Number), opts = '';
    while (bh <= AGENDA_END) {
        opts += `<option value="${String(bh).padStart(2,'0')}:${String(bm).padStart(2,'0')}">${String(bh).padStart(2,'0')}:${String(bm).padStart(2,'0')}</option>`;
        bm += 30; if (bm >= 60) { bh++; bm = 0; }
    }
    const blockSel = document.getElementById('block-until-time');
    blockSel.innerHTML = opts;
    blockSel.value = baseTime;
}

function handleConsultationTypeChange() {
    const type    = document.getElementById('appointment-consultation-type').value;
    const timeSel = document.getElementById('appointment-time');
    const base    = document.getElementById('appointment-base-time').value;
    const retInfo = document.getElementById('return-info');
    const [h, m]  = base.split(':').map(Number);
    if (RETURN_TYPES.includes(type)) {
        timeSel.innerHTML = m === 0
            ? `<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00</option><option value="${String(h).padStart(2,'0')}:15">${String(h).padStart(2,'0')}:15</option>`
            : `<option value="${String(h).padStart(2,'0')}:30">${String(h).padStart(2,'0')}:30</option><option value="${String(h).padStart(2,'0')}:45">${String(h).padStart(2,'0')}:45</option>`;
        retInfo.classList.remove('hidden');
    } else {
        timeSel.innerHTML = `<option value="${base}">${base}</option>`;
        retInfo.classList.add('hidden');
    }
}

function showPatientSearch() {
    const input   = document.getElementById('patient-name');
    const results = document.getElementById('patient-search-results');
    if (!input || !results) return;
    const term = input.value.toLowerCase().trim();
    if (term.length < 2) { results.classList.add('hidden'); return; }
    const found = patients.filter(p => p.name.toLowerCase().includes(term)).slice(0, 6);
    results.innerHTML = found.map(p => {
        // FIX: escapa aspas simples no nome para não quebrar o onclick
        const safeName  = p.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const safePhone = (p.phone||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `<div class="p-2 hover:bg-gray-100 cursor-pointer border-b" onclick="window.selectPatient('${safeName}','${safePhone}')">
            <div class="font-medium">${p.name}</div>
            ${p.phone ? `<div class="text-xs text-gray-600">${window.formatPhoneNumber(p.phone)}</div>` : ''}
        </div>`;
    }).join('');
    results.classList.toggle('hidden', found.length === 0);
}

window.selectPatient = (name, phone) => {
    document.getElementById('patient-name').value  = name;
    document.getElementById('patient-phone').value = window.formatPhoneNumber(phone);
    document.getElementById('patient-search-results').classList.add('hidden');
};

function handleStatusChange() {
    const s = document.getElementById('appointment-status').value;
    const isBlock = s === 'Fechada' || s === 'Aberta';
    document.getElementById('block-until-container').classList.toggle('hidden', !isBlock);
    document.getElementById('patient-info-container').classList.toggle('hidden', isBlock);
    document.getElementById('patient-name').required = !isBlock;
}

// ─── SALVAR / EXCLUIR ─────────────────────────────────────────────────────────
async function saveAppointment(e) {
    e.preventDefault();
    const status = document.getElementById('appointment-status').value;
    if (status === 'Fechada' || status === 'Aberta') { await saveBlockedSlots(status); return; }

    const id     = document.getElementById('appointment-id').value.trim();
    const time   = document.getElementById('appointment-time').value;
    const col    = document.getElementById('appointment-column').value;
    const date   = getSelectedDate();
    if (!date || !time || !col) { showNotification('error', 'Dados incompletos.'); return; }

    const procs  = Array.from(document.querySelectorAll('input[name="procedures"]:checked')).map(cb => cb.value);
    const pName  = toTitleCase(document.getElementById('patient-name').value.trim());
    const pPhone = document.getElementById('patient-phone').value.replace(/\D/g, '');

    if (!pName) { showNotification('error', 'Nome do paciente é obrigatório.'); return; }

    const newKey = `${date}-${col}-${time}`;
    const oldKey = id || newKey;

    // Usa currentUnit — sempre atualizado por changeUnit() antes do salvamento
    const unitAtSave = currentUnit;
    if (!unitAtSave || !UNIT_NAMES[unitAtSave]) {
        showNotification('error', 'Unidade inválida. Recarregue a página.');
        return;
    }

    const data = {
        status, patientName: pName, patientPhone: pPhone,
        professionalName: document.getElementById('appointment-professional').value,
        consultationType: document.getElementById('appointment-consultation-type').value,
        medication:       document.getElementById('appointment-medication').value,
        procedures: procs, observation: document.getElementById('observation').value.trim(),
        date, time, column: col, unit: unitAtSave,
        lastModifiedBy: currentUser.email, lastModifiedAt: serverTimestamp(),
    };

    if (id) {
        const existing    = appointments[oldKey];
        data.createdBy    = existing?.createdBy || currentUser.email;
        data.userId       = existing?.userId    || currentUser.uid;
    } else {
        data.createdBy    = currentUser.email;
        data.createdAt    = serverTimestamp();
        data.userId       = currentUser.uid;
    }

    try {
        // Salva/atualiza paciente
        const pq = await getDocs(query(collection(db, 'patients'), where('name', '==', pName), limit(1)));
        if (pq.empty) {
            await addDoc(collection(db, 'patients'), { name: pName, phone: pPhone, userId: currentUser.uid });
        } else if (pq.docs[0].data().phone !== pPhone) {
            await updateDoc(doc(db, 'patients', pq.docs[0].id), { phone: pPhone });
        }

        // FIX: se horário foi alterado na edição, move o documento para a nova chave
        if (id && id !== newKey) {
            const batch = writeBatch(db);
            batch.delete(doc(db, 'appointments', oldKey));
            batch.set(doc(db, 'appointments', newKey), data);
            await batch.commit();
        } else {
            await setDoc(doc(db, 'appointments', newKey), data, { merge: true });
        }
        showNotification('success', 'Agendamento salvo!');
        closeModal('modal-agendamento');
    } catch (err) {
        console.error('Erro ao salvar:', err);
        showNotification('error', 'Erro ao salvar. Tente novamente.');
    }
}

async function saveBlockedSlots(status) {
    const startTime = document.getElementById('appointment-time').value;
    const endTime   = document.getElementById('block-until-time').value;
    const col       = document.getElementById('appointment-column').value;
    const date      = getSelectedDate();
    const obs       = document.getElementById('observation').value.trim() || status;

    let cur = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    if (cur > end) { showNotification('error', 'Horário final deve ser igual ou após o inicial.'); return; }

    const unitAtSave = currentUnit;
    const batch = writeBatch(db);
    let count = 0;
    while (cur <= end && count < 100) {
        const ts = `${String(cur.getHours()).padStart(2,'0')}:${String(cur.getMinutes()).padStart(2,'0')}`;
        batch.set(doc(db, 'appointments', `${date}-${col}-${ts}`), {
            status, observation: obs, date, time: ts, column: col, unit: unitAtSave,
            userId: currentUser.uid, createdBy: currentUser.email, createdAt: serverTimestamp(),
            lastModifiedBy: currentUser.email, lastModifiedAt: serverTimestamp(),
        });
        cur.setMinutes(cur.getMinutes() + 15);
        count++;
    }
    try {
        await batch.commit();
        showNotification('success', 'Horários bloqueados!');
        closeModal('modal-agendamento');
    } catch (err) { console.error(err); showNotification('error', 'Erro ao bloquear horários.'); }
}

async function unblockSlots() {
    if (!confirm('DESBLOQUEAR horários? Cards "Aberta" e "Fechada" serão removidos.')) return;
    const startTime = document.getElementById('appointment-base-time').value;
    const endTime   = document.getElementById('block-until-time').value;
    const col       = document.getElementById('appointment-column').value;
    const date      = getSelectedDate();
    let cur = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    if (cur > end) { showNotification('error', 'Horário final deve ser igual ou após o inicial.'); return; }
    const batch = writeBatch(db);
    let safeCount = 0;
    while (cur <= end && safeCount < 100) {
        const ts = `${String(cur.getHours()).padStart(2,'0')}:${String(cur.getMinutes()).padStart(2,'0')}`;
        const k  = `${date}-${col}-${ts}`;
        if (appointments[k] && ['Aberta','Fechada'].includes(appointments[k].status)) batch.delete(doc(db, 'appointments', k));
        cur.setMinutes(cur.getMinutes() + 15);
        safeCount++;
    }
    try {
        await batch.commit();
        showNotification('success', 'Horários desbloqueados!');
        closeModal('modal-agendamento');
    } catch (err) { console.error(err); showNotification('error', 'Erro ao desbloquear.'); }
}

function deleteAppointment() {
    const k = document.getElementById('appointment-id').value?.trim();
    if (!k) { showNotification('error', 'Erro: agendamento sem ID. Recarregue a página.'); return; }
    if (!confirm('Tem certeza que deseja excluir este agendamento?')) return;
    setDoc(doc(db, 'appointments', k), {
        status: 'Excluído', deletedBy: currentUser.email, deletedAt: serverTimestamp(),
        lastModifiedBy: currentUser.email, lastModifiedAt: serverTimestamp(),
    }, { merge: true })
    .then(() => { showNotification('success', 'Excluído!'); closeModal('modal-agendamento'); })
    .catch(err => { console.error(err); showNotification('error', 'Erro ao excluir.'); });
}

// ─── CADASTROS ────────────────────────────────────────────────────────────────
window.toggleAccordion = (btn) => {
    btn.nextElementSibling.classList.toggle('open');
    btn.querySelector('.accordion-arrow').classList.toggle('open');
};
window.openCadastrosWithPassword = () => {
    const p = prompt('Insira a senha para acessar:');
    if (p === '1970') openCadastrosModal();
    else if (p !== null) alert('Senha incorreta!');
};
function buildAccordion(title, body) {
    return `<div class="border rounded-lg"><button onclick="toggleAccordion(this)" class="w-full flex justify-between items-center p-4 font-semibold text-lg"><span>${title}</span><svg class="w-5 h-5 accordion-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg></button><div class="accordion-content px-4">${body}</div></div>`;
}
function openCadastrosModal() {
    document.getElementById('modal-cadastros').innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-2xl fade-in max-h-[95vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-4"><h2 class="text-2xl font-bold">Cadastros</h2><button onclick="closeModal('modal-cadastros')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div>
      <div class="space-y-2">
        ${buildAccordion('Médicos',`<div class="flex gap-2 mb-4"><input type="text" id="new-medico-name" placeholder="Nome do Médico" class="form-input flex-1"><button id="add-medico-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="medicos-list" class="max-h-60 overflow-y-auto space-y-2">${renderMedicosList()}</div>`)}
        ${buildAccordion('Profissionais (Enfermagem)',`<div class="flex gap-2 mb-4"><input type="text" id="new-enfermagem-name" placeholder="Nome do Profissional" class="form-input flex-1"><button id="add-enfermagem-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="enfermagem-list" class="max-h-60 overflow-y-auto space-y-2">${renderEnfermagemList()}</div>`)}
        ${buildAccordion('Procedimentos',`<div class="flex gap-2 mb-4"><input type="text" id="new-procedure-name" placeholder="Nome do Procedimento" class="form-input flex-1"><button id="add-procedure-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="procedures-list" class="max-h-60 overflow-y-auto space-y-2">${renderProceduresList()}</div>`)}
        ${buildAccordion('Medicações',`<div class="flex gap-2 mb-4"><input type="text" id="new-medication-name" placeholder="Nome da Medicação" class="form-input flex-1"><button id="add-medication-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="medications-list" class="max-h-60 overflow-y-auto space-y-2">${renderMedicationsList()}</div>`)}
        ${buildAccordion('Tags de Observação',`<div class="flex gap-2 mb-4"><input type="text" id="new-tag-name" placeholder="Nome da Tag" class="form-input flex-1"><button id="add-tag-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="tags-list" class="max-h-60 overflow-y-auto space-y-2">${renderTagsList()}</div>`)}
      </div>
    </div>`;
    document.getElementById('add-medico-btn').onclick     = () => addProfessional('medicos');
    document.getElementById('add-enfermagem-btn').onclick = () => addProfessional('enfermagem');
    document.getElementById('add-procedure-btn').onclick  = addProcedure;
    document.getElementById('add-medication-btn').onclick = addMedication;
    document.getElementById('add-tag-btn').onclick        = addTag;
    openModal('modal-cadastros');
}
const itemRow = (name, fn, id) => `<div class="flex justify-between items-center p-2 border-b"><span>${name}</span><button onclick="window.${fn}('${id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`;
function renderMedicosList()    { return professionals.medicos.map(p    => itemRow(p.name,'deleteProfessional',p.id)).join('') || '<p class="text-gray-400 text-sm p-2">Nenhum cadastrado.</p>'; }
function renderEnfermagemList() { return professionals.enfermagem.map(p => itemRow(p.name,'deleteProfessional',p.id)).join('') || '<p class="text-gray-400 text-sm p-2">Nenhum cadastrado.</p>'; }
function renderMedicationsList(){ return medications.map(m              => itemRow(m.name,'deleteMedication',m.id)).join('')   || '<p class="text-gray-400 text-sm p-2">Nenhuma cadastrada.</p>'; }
function renderProceduresList() { return procedures.map(p               => itemRow(p.name,'deleteProcedure',p.id)).join('')   || '<p class="text-gray-400 text-sm p-2">Nenhum cadastrado.</p>'; }
function renderTagsList()       { return [...availableTags].sort((a,b)=>a.localeCompare(b)).map(t=>`<div class="flex justify-between items-center p-2 border-b"><span>${t}</span><button onclick="window.deleteTag('${t}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join('') || '<p class="text-gray-400 text-sm p-2">Nenhuma tag.</p>'; }

async function addProfessional(role) {
    const id   = role === 'medicos' ? 'new-medico-name' : 'new-enfermagem-name';
    const name = document.getElementById(id).value.trim();
    if (!name) return showNotification('error', 'Digite o nome.');
    try { await addDoc(collection(db,'professionals'),{name,role,userId:currentUser.uid,createdAt:serverTimestamp()}); document.getElementById(id).value=''; showNotification('success','Adicionado!'); }
    catch(e){console.error(e);showNotification('error','Erro ao adicionar.');}
}
async function addMedication() {
    const name = document.getElementById('new-medication-name').value.trim();
    if (!name) return showNotification('error','Digite o nome.');
    try { await addDoc(collection(db,'medications'),{name,userId:currentUser.uid,createdAt:serverTimestamp()}); document.getElementById('new-medication-name').value=''; showNotification('success','Adicionada!'); }
    catch(e){console.error(e);showNotification('error','Erro.');}
}
async function addProcedure() {
    const name = document.getElementById('new-procedure-name').value.trim();
    if (!name) return showNotification('error','Digite o nome.');
    try { await addDoc(collection(db,'procedures'),{name,userId:currentUser.uid,createdAt:serverTimestamp()}); document.getElementById('new-procedure-name').value=''; showNotification('success','Adicionado!'); }
    catch(e){console.error(e);showNotification('error','Erro.');}
}
function addTag() {
    const name = document.getElementById('new-tag-name').value.trim();
    if (!name) return showNotification('error','Digite a tag.');
    if (availableTags.includes(name)) return showNotification('warning','Tag já existe.');
    availableTags.push(name); availableTags.sort((a,b)=>a.localeCompare(b));
    saveTagsConfig(); document.getElementById('new-tag-name').value=''; showNotification('success','Adicionada!');
    document.getElementById('tags-list').innerHTML = renderTagsList();
}
window.deleteProfessional = async (id) => { if(!confirm('Excluir profissional?'))return; try{await deleteDoc(doc(db,'professionals',id));showNotification('success','Excluído!');}catch(e){console.error(e);showNotification('error','Erro.');} };
window.deleteMedication   = async (id) => { if(!confirm('Excluir medicação?'))return;   try{await deleteDoc(doc(db,'medications',id));showNotification('success','Excluída!');}catch(e){console.error(e);showNotification('error','Erro.');} };
window.deleteProcedure    = async (id) => { if(!confirm('Excluir procedimento?'))return; try{await deleteDoc(doc(db,'procedures',id));showNotification('success','Excluído!');}catch(e){console.error(e);showNotification('error','Erro.');} };
window.deleteTag = (tagName) => { if(!confirm('Excluir tag?'))return; availableTags=availableTags.filter(t=>t!==tagName); saveTagsConfig(); showNotification('success','Excluída!'); document.getElementById('tags-list').innerHTML=renderTagsList(); };

// ─── OBSERVAÇÕES ──────────────────────────────────────────────────────────────
window.openObservationsModal = () => {
    const tagsHTML   = availableTags.map(t=>`<span class="tag modal-tag" style="background-color:${getTagColor(t).bg};color:${getTagColor(t).t}" data-tag="${t}" onclick="window.toggleTagSelection(this)">${t}</span>`).join('');
    const tagOptions = '<option value="">Todas as Tags</option>'+[...availableTags].sort((a,b)=>a.localeCompare(b)).map(t=>`<option value="${t}">${t}</option>`).join('');
    const today      = new Date();
    const defMonth   = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    document.getElementById('modal-lista-observacoes').innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-4xl fade-in max-h-[95vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-6"><h2 class="text-2xl font-bold">Observações</h2><button onclick="closeModal('modal-lista-observacoes')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div>
      <div class="space-y-4">
        <textarea id="observation-text" rows="3" class="form-input" placeholder="Digite sua observação..."></textarea>
        <div><button onclick="window.openTagsConfigModal()" class="btn btn-secondary !py-1 !px-3 text-xs mb-2">Gerenciar Tags</button><div id="modal-tags-selection-container" class="flex flex-wrap gap-2 py-2">${tagsHTML}</div></div>
        <div class="flex justify-end pt-4 border-t"><button id="save-observation-btn" class="btn btn-primary">Salvar Observação</button></div>
        <div class="border-t pt-4">
          <h3 class="text-lg font-bold mb-4">Observações Recentes</h3>
          <div class="flex items-center gap-4 mb-4"><input type="month" id="obs-filter-month" class="form-input w-48" value="${defMonth}"><select id="obs-filter-tag" class="form-input flex-1">${tagOptions}</select></div>
          <div id="observations-list-container" class="space-y-3 max-h-80 overflow-y-auto invisible-scrollbar"></div>
        </div>
      </div>
    </div>`;
    document.getElementById('save-observation-btn').onclick = saveObservation;
    document.getElementById('obs-filter-month').onchange    = applyObservationFilters;
    document.getElementById('obs-filter-tag').onchange      = applyObservationFilters;
    openModal('modal-lista-observacoes');
    applyObservationFilters();
};
window.toggleTagSelection = (el) => el.classList.toggle('selected-tag');
function applyObservationFilters() {
    const month = document.getElementById('obs-filter-month')?.value;
    const tag   = document.getElementById('obs-filter-tag')?.value;
    let f = [...observations];
    if (month) { const [y,mo]=month.split('-'); f=f.filter(o=>{ const d=o.createdAt; return d.getFullYear()==y&&(d.getMonth()+1)==mo; }); }
    if (tag)   f = f.filter(o => o.tags?.includes(tag));
    const c = document.getElementById('observations-list-container');
    if (c) c.innerHTML = f.length === 0 ? '<p class="text-gray-500 text-center py-4">Nenhuma observação encontrada.</p>'
        : f.map(o=>{
            const date = o.createdAt?.toLocaleDateString?.('pt-BR')||'';
            const tags = (o.tags||[]).map(t=>`<span class="tag text-xs" style="background-color:${getTagColor(t).bg};color:${getTagColor(t).t}">${t}</span>`).join('');
            return `<div class="p-3 border rounded-lg bg-white shadow-sm"><div class="flex justify-between items-start mb-2"><div class="flex flex-wrap gap-1">${tags}</div><span class="text-xs text-gray-500 shrink-0 ml-2">${date}</span></div><p class="text-gray-700 break-words">${o.text}</p><div class="flex justify-between items-center mt-2"><span class="text-xs text-gray-500">Por: ${o.createdBy||'Usuário'}</span><button onclick="window.deleteObservation('${o.id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div></div>`;
        }).join('');
}
async function saveObservation() {
    const text = document.getElementById('observation-text').value.trim();
    const sel  = document.querySelectorAll('#modal-tags-selection-container .selected-tag');
    const tags = Array.from(sel).map(el=>el.dataset.tag);
    if (!text) return showNotification('error','Digite a observação.');
    try { await addDoc(collection(db,'observations'),{text,tags,createdBy:currentUser.email,userId:currentUser.uid,createdAt:serverTimestamp()}); document.getElementById('observation-text').value=''; sel.forEach(el=>el.classList.remove('selected-tag')); showNotification('success','Observação salva!'); }
    catch(e){console.error(e);showNotification('error','Erro ao salvar.');}
}
window.deleteObservation = async (id) => { if(!confirm('Excluir observação?'))return; try{await deleteDoc(doc(db,'observations',id));showNotification('success','Excluída!');}catch(e){console.error(e);showNotification('error','Erro.');} };
function renderTagsSummary() {
    const c = document.getElementById('tags-container'); if (!c) return;
    const counts = {};
    observations.forEach(o=>(o.tags||[]).forEach(t=>{counts[t]=(counts[t]||0)+1;}));
    c.innerHTML = Object.keys(counts).sort().filter(t=>counts[t]>0)
        .map(t=>`<span class="tag cursor-pointer" style="background-color:${getTagColor(t).bg};color:${getTagColor(t).t}" onclick="window.filterByTag('${t}')">${t} (${counts[t]})</span>`).join('')
        || '<p class="text-sm text-gray-500">Nenhuma tag utilizada.</p>';
}
window.filterByTag = (tag) => { window.openObservationsModal(); setTimeout(()=>{ const s=document.getElementById('obs-filter-tag'); if(s){s.value=tag;applyObservationFilters();} },100); };
window.openTagsConfigModal = () => {
    const getList = () => [...availableTags].sort((a,b)=>a.localeCompare(b)).map(t=>`<div class="flex justify-between items-center p-2 border rounded"><span class="tag" style="background-color:${getTagColor(t).bg};color:${getTagColor(t).t}">${t}</span><button onclick="window.removeConfigTag('${t}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join('');
    document.getElementById('modal-tags-config').innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md fade-in">
      <div class="flex justify-between items-center mb-6"><h2 class="text-xl font-bold">Configurar Tags</h2><button onclick="closeModal('modal-tags-config')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div>
      <div class="space-y-4">
        <div class="flex gap-2"><input type="text" id="new-config-tag" placeholder="Nova tag" class="form-input flex-1"><button id="add-config-tag-btn" class="btn btn-primary">Add</button></div>
        <div id="config-tags-list" class="max-h-60 overflow-y-auto space-y-2">${getList()}</div>
        <div class="flex gap-2 pt-4"><button onclick="closeModal('modal-tags-config')" class="btn btn-secondary flex-1">Cancelar</button><button id="save-tags-config-btn" class="btn btn-primary flex-1">Salvar</button></div>
      </div>
    </div>`;
    document.getElementById('add-config-tag-btn').onclick = () => {
        const i=document.getElementById('new-config-tag'),t=i.value.trim();
        if(!t)return showNotification('error','Digite a tag');
        if(availableTags.includes(t))return showNotification('warning','Tag já existe');
        availableTags.push(t); document.getElementById('config-tags-list').innerHTML=getList(); i.value='';
    };
    document.getElementById('save-tags-config-btn').onclick = () => { saveTagsConfig(); closeModal('modal-tags-config'); if(!document.getElementById('modal-lista-observacoes')?.classList.contains('hidden'))window.openObservationsModal(); showNotification('success','Tags salvas!'); };
    openModal('modal-tags-config');
};
window.removeConfigTag = (t) => {
    availableTags = availableTags.filter(tag=>tag!==t);
    const c = document.getElementById('config-tags-list');
    if(c) c.innerHTML = [...availableTags].sort((a,b)=>a.localeCompare(b)).map(tag=>`<div class="flex justify-between items-center p-2 border rounded"><span class="tag" style="background-color:${getTagColor(tag).bg};color:${getTagColor(tag).t}">${tag}</span><button onclick="window.removeConfigTag('${tag}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join('');
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
window.openDashboardModal = () => {
    const today=new Date(), first=new Date(today.getFullYear(),today.getMonth(),1).toISOString().split('T')[0], last=new Date(today.getFullYear(),today.getMonth()+1,0).toISOString().split('T')[0];
    document.getElementById('modal-dashboard').innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-6xl fade-in max-h-[95vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-6"><h2 class="text-2xl font-bold">Dashboard</h2><button onclick="closeModal('modal-dashboard')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div><label class="form-label">Data Início</label><input type="date" id="dashboard-start-date" class="form-input" value="${first}"></div>
        <div><label class="form-label">Data Final</label><input type="date" id="dashboard-end-date" class="form-input" value="${last}"></div>
      </div>
      <div class="flex gap-4 mb-6"><button id="dashboard-medicos-btn" class="btn btn-primary flex-1">Dashboard Médicos</button><button id="dashboard-enfermagem-btn" class="btn btn-secondary flex-1">Dashboard Enfermagem</button></div>
      <div id="dashboard-content"><div class="text-center text-gray-500 py-8">Selecione as datas e clique em um dashboard.</div></div>
    </div>`;
    document.getElementById('dashboard-medicos-btn').onclick    = showMedicosDashboard;
    document.getElementById('dashboard-enfermagem-btn').onclick = showEnfermagemDashboard;
    openModal('modal-dashboard');
};

// FIX: Fechada e Aberta excluídos das estatísticas
function getDashboardList(s, e, medicoOnly) {
    const start = new Date(s+'T00:00:00'), end = new Date(e+'T23:59:59');
    return Object.values(appointments).filter(a => {
        const d = new Date(a.date+'T00:00:00');
        return d>=start && d<=end && !['Excluído','Fechada','Aberta'].includes(a.status)
            && (medicoOnly ? a.column?.startsWith('Médico') : !a.column?.startsWith('Médico'));
    });
}
function mkTable(rows, cols) {
    return `<div class="table-responsive invisible-scrollbar"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function pct(n,d){ return d>0?`${((n/d)*100).toFixed(1)}%`:'0%'; }

function showMedicosDashboard() {
    const s=document.getElementById('dashboard-start-date').value, e=document.getElementById('dashboard-end-date').value;
    if(!s||!e)return showNotification('error','Selecione as datas.');
    const list=getDashboardList(s,e,true), total=list.length, conf=list.filter(a=>a.status==='Confirmada').length, faltas=list.filter(a=>a.status==='Faltou').length;
    const porTipo={}, porProc={}, porMed={};
    const abrev={'Consulta':'CT','Nova Consulta':'NC','Retorno Presencial':'RT','Retorno Online':'RT','Reavaliação Final':'RV','Reavaliação Meio':'RV'};
    list.forEach(a=>{
        const tipo=a.consultationType||'Consulta';
        porTipo[tipo]=porTipo[tipo]||{t:0,c:0,f:0}; porTipo[tipo].t++; if(a.status==='Confirmada')porTipo[tipo].c++; if(a.status==='Faltou')porTipo[tipo].f++;
        (a.procedures?.length?a.procedures:['Sem procedimento']).forEach(p=>{porProc[p]=porProc[p]||{t:0,c:0,f:0};porProc[p].t++;if(a.status==='Confirmada')porProc[p].c++;if(a.status==='Faltou')porProc[p].f++;});
        if(a.professionalName){const m=a.professionalName;porMed[m]=porMed[m]||{t:0,c:0,f:0,h:0,tipos:{}};porMed[m].t++;if(a.status==='Confirmada')porMed[m].c++;if(a.status==='Faltou')porMed[m].f++;porMed[m].h+=CONSULTATION_DURATIONS[a.consultationType]||1.0;porMed[m].tipos[tipo]=(porMed[m].tipos[tipo]||0)+1;}
    });
    document.getElementById('dashboard-content').innerHTML = `<div class="space-y-6">
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Visão Geral — Médicos</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-4"><div class="stat-card"><div class="stat-number">${total}</div><div class="stat-label">Total Agendado</div></div><div class="stat-card"><div class="stat-number">${conf}</div><div class="stat-label">Confirmados</div></div><div class="stat-card"><div class="stat-number">${faltas}</div><div class="stat-label">Faltas</div></div><div class="stat-card"><div class="stat-number">${pct(conf,total)}</div><div class="stat-label">Taxa de Comparecimento</div></div></div></div>
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-3">Por Tipo de Consulta</h3>${mkTable(Object.entries(porTipo).map(([t,d])=>[t,d.t,d.c,d.f,pct(d.c,d.t),pct(d.c,conf)]),['Tipo','Total','Conf.','Faltas','Comp.%','% Conf. Geral'])}</div>
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-3">Por Procedimento</h3>${mkTable(Object.entries(porProc).map(([p,d])=>[p,d.t,d.c,d.f]),['Procedimento','Total','Conf.','Faltas'])}</div>
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-3">Por Médico</h3>${mkTable(Object.entries(porMed).map(([m,d])=>[m,d.t,pct(d.t,total),d.c,d.f,pct(d.c,d.t),`${d.h.toFixed(1)}h`,Object.entries(d.tipos).map(([t,c])=>`${abrev[t]||t}:${c}`).join(', ')]),['Médico','Consultas','% Total','Conf.','Faltas','Comp.%','Horas','Tipos'])}</div>
    </div>`;
}

function showEnfermagemDashboard() {
    const s=document.getElementById('dashboard-start-date').value, e=document.getElementById('dashboard-end-date').value;
    if(!s||!e)return showNotification('error','Selecione as datas.');
    const list=getDashboardList(s,e,false), total=list.length, conf=list.filter(a=>a.status==='Confirmada').length, faltas=list.filter(a=>a.status==='Faltou').length;
    const porProc={}, porProf={};
    list.forEach(a=>{
        (a.procedures?.length?a.procedures:['Sem procedimento']).forEach(p=>{porProc[p]=porProc[p]||{t:0,c:0,f:0};porProc[p].t++;if(a.status==='Confirmada')porProc[p].c++;if(a.status==='Faltou')porProc[p].f++;});
        if(a.professionalName){const pf=a.professionalName;porProf[pf]=porProf[pf]||{t:0,c:0,f:0,procs:{}};porProf[pf].t++;if(a.status==='Confirmada')porProf[pf].c++;if(a.status==='Faltou')porProf[pf].f++;(a.procedures?.length?a.procedures:['Sem procedimento']).forEach(p=>{porProf[pf].procs[p]=(porProf[pf].procs[p]||0)+1;});}
    });
    document.getElementById('dashboard-content').innerHTML = `<div class="space-y-6">
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Visão Geral — Enfermagem</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-4"><div class="stat-card-enfermagem"><div class="stat-number">${total}</div><div class="stat-label">Total Agendado</div></div><div class="stat-card-enfermagem"><div class="stat-number">${conf}</div><div class="stat-label">Confirmados</div></div><div class="stat-card-enfermagem"><div class="stat-number">${faltas}</div><div class="stat-label">Faltas</div></div><div class="stat-card-enfermagem"><div class="stat-number">${pct(conf,total)}</div><div class="stat-label">Taxa de Comparecimento</div></div></div></div>
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-3">Por Procedimento</h3>${mkTable(Object.entries(porProc).map(([p,d])=>[p,d.t,d.c,d.f,pct(d.c,d.t)]),['Procedimento','Total','Conf.','Faltas','Comp.%'])}</div>
      <div class="dashboard-card"><h3 class="text-lg font-bold mb-3">Por Profissional</h3>${mkTable(Object.entries(porProf).map(([p,d])=>[p,d.t,pct(d.t,total),d.c,d.f,pct(d.c,d.t),Object.entries(d.procs).map(([pr,c])=>`${pr}:${c}`).join(', ')]),['Profissional','Atend.','% Total','Conf.','Faltas','Comp.%','Procedimentos'])}</div>
    </div>`;
}

// ─── RELATÓRIOS ───────────────────────────────────────────────────────────────
window.openReportsModal = () => {
    const today=new Date(), first=new Date(today.getFullYear(),today.getMonth(),1).toISOString().split('T')[0], last=new Date(today.getFullYear(),today.getMonth()+1,0).toISOString().split('T')[0];
    document.getElementById('modal-relatorios').innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-7xl fade-in max-h-[95vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-6"><h2 class="text-2xl font-bold">Gerador de Relatórios</h2><button onclick="closeModal('modal-relatorios')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div>
      <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div><label class="form-label">Data Início</label><input type="date" id="report-start-date" class="form-input" value="${first}"></div>
        <div><label class="form-label">Data Final</label><input type="date" id="report-end-date" class="form-input" value="${last}"></div>
        <div><label class="form-label">Profissional</label><select id="report-professional" class="form-input"><option value="Todos">Todos</option>${[...professionals.medicos,...professionals.enfermagem].map(p=>`<option value="${p.name}">${p.name}</option>`).join('')}</select></div>
        <div><label class="form-label">Consulta</label><select id="report-consultation-type" class="form-input"><option value="Todas">Todas</option>${Object.keys(CONSULTATION_TYPES).filter(k=>k).map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div>
        <div><label class="form-label">Procedimento</label><select id="report-procedure" class="form-input"><option value="Todos">Todos</option>${procedures.map(p=>`<option value="${p.name}">${p.name}</option>`).join('')}</select></div>
        <div><label class="form-label">Status</label><select id="report-status" class="form-input"><option value="Todos">Todos</option><option>Agendada</option><option>Confirmada</option><option>Faltou</option><option>Aberta</option><option>Fechada</option></select></div>
      </div>
      <div class="flex gap-4 mb-6"><button id="generate-report-btn" class="btn btn-primary">Gerar Relatório</button><button id="print-report-btn" class="btn btn-secondary">Imprimir</button><button id="export-excel-btn" class="btn btn-secondary">Exportar Excel</button></div>
      <div id="report-content" class="dashboard-card"><div class="text-center text-gray-500 py-8">Configure os filtros e gere o relatório.</div></div>
    </div>`;
    document.getElementById('generate-report-btn').onclick = generateReport;
    document.getElementById('print-report-btn').onclick    = printReport;
    document.getElementById('export-excel-btn').onclick    = exportReportToExcel;
    openModal('modal-relatorios');
};

function generateReport() {
    const s=document.getElementById('report-start-date').value, e=document.getElementById('report-end-date').value;
    const prof=document.getElementById('report-professional').value, type=document.getElementById('report-consultation-type').value;
    const proc=document.getElementById('report-procedure').value,   stat=document.getElementById('report-status').value;
    if(!s||!e)return showNotification('error','Selecione as datas.');
    const start=new Date(s+'T00:00:00'), end=new Date(e+'T23:59:59');
    currentReportData = Object.values(appointments).filter(a=>{
        const d=new Date(a.date+'T00:00:00');
        return d>=start&&d<=end&&(prof==='Todos'||a.professionalName===prof)&&(type==='Todas'||a.consultationType===type)&&(proc==='Todos'||a.procedures?.includes(proc))&&(stat==='Todos'||a.status===stat);
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
    const rows = currentReportData.map(a=>`<tr><td>${formatDateDDMMYY(a.date)}</td><td>${a.time}</td><td>${a.patientName||''}</td><td>${window.formatPhoneNumber(a.patientPhone||'')}</td><td>${a.professionalName||''}</td><td>${a.consultationType||''}</td><td>${(a.procedures||[]).join(', ')}</td><td>${a.medication||''}</td><td>${a.status}</td></tr>`).join('');
    document.getElementById('report-content').innerHTML = `<div class="space-y-4"><h3 class="text-lg font-bold">Relatório de Agendamentos</h3><div class="table-responsive invisible-scrollbar"><table class="data-table report-view"><thead><tr><th>Data</th><th>Horário</th><th>Paciente</th><th>Telefone</th><th>Profissional</th><th>Tipo</th><th>Procedimentos</th><th>Medicação</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><div class="text-sm text-gray-600 mt-4"><strong>Total:</strong> ${currentReportData.length} registros</div></div>`;
}

function printReport() {
    if(!currentReportData.length)return showNotification('warning','Gere o relatório primeiro.');
    const s=document.getElementById('report-start-date').value, e=document.getElementById('report-end-date').value;
    const rows=currentReportData.map(a=>`<tr><td>${formatDateDDMMYY(a.date)}</td><td>${a.time}</td><td>${a.patientName||''}</td><td>${a.professionalName||''}</td><td>${a.consultationType||''}</td><td>${(a.procedures||[]).join(', ')}</td><td>${a.status}</td></tr>`).join('');
    document.getElementById('report-printable-area').innerHTML=`<div class="print-header-info"><h1>Relatório de Agendamentos</h1><p>Período: ${formatDateDDMMYY(s)} a ${formatDateDDMMYY(e)}</p></div><table class="print-table"><thead><tr><th>Data</th><th>Hora</th><th>Paciente</th><th>Profissional</th><th>Tipo</th><th>Procedimentos</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.print();
}

function exportReportToExcel() {
    if(!currentReportData.length)return showNotification('warning','Gere o relatório primeiro.');
    try {
        const data=currentReportData.map(a=>({'Data':formatDateDDMMYY(a.date),'Horário':a.time,'Paciente':a.patientName||'','Telefone':window.formatPhoneNumber(a.patientPhone||''),'Profissional':a.professionalName||'','Tipo':a.consultationType||'','Procedimentos':(a.procedures||[]).join(', '),'Medicação':a.medication||'','Status':a.status}));
        const ws=XLSX.utils.json_to_sheet(data), wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,ws,'Relatório');
        XLSX.writeFile(wb,`relatorio_${new Date().toISOString().split('T')[0]}.xlsx`);
        showNotification('success','Relatório exportado!');
    } catch(err){console.error(err);showNotification('error','Erro ao exportar.');}
}

// ─── BACKUP & RESTORE ─────────────────────────────────────────────────────────
window.backupData = async () => {
    if(!confirm('Fazer backup de todos os dados?'))return;
    showNotification('info','Iniciando backup...',0);
    const colls=['professionals','medications','procedures','patients','appointments','observations'], backup={};
    try {
        for(const c of colls){
                const snap=await getDocs(collection(db,c));
                backup[c]=snap.docs.map(d=>{
                    const data=d.data();
                    // Converte Timestamps para ISO string para serialização JSON limpa
                    Object.keys(data).forEach(k=>{
                        if(data[k]&&typeof data[k].toDate==='function') data[k]=data[k].toDate().toISOString();
                    });
                    return {id:d.id,...data};
                });
            }
        const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob), a=document.createElement('a');
        a.href=url; a.download=`backup_tricomaster_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showNotification('success','Backup concluído!');
    } catch(e){console.error(e);showNotification('error','Falha no backup.');}
};

window.restoreData = (e) => {
    const f=e.target.files[0]; if(!f)return;
    const r=new FileReader();
    r.onload = function(ev) {
        try {
            const data=JSON.parse(ev.target.result);
            document.getElementById('modal-restore-confirm').innerHTML=`<div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg fade-in"><h2 class="text-xl font-bold text-red-600">Atenção!</h2><p class="my-4">Você vai substituir TODOS os dados atuais pelos do backup. Esta ação não pode ser desfeita. Continuar?</p><div class="flex justify-end gap-4 mt-6"><button onclick="closeModal('modal-restore-confirm')" class="btn btn-secondary">Cancelar</button><button id="confirm-restore-btn" class="btn bg-red-600 hover:bg-red-700 text-white">Sim, Restaurar</button></div></div>`;
            openModal('modal-restore-confirm');
            document.getElementById('confirm-restore-btn').onclick=async()=>{ closeModal('modal-restore-confirm'); showNotification('info','Restaurando, aguarde...',0); await performRestore(data); };
        } catch(err){showNotification('error','Arquivo de backup inválido.');console.error(err);}
        finally{e.target.value='';}
    };
    r.readAsText(f); // FIX: era readText() — método inexistente
};

async function performRestore(data) {
    try {
        for(const c of Object.keys(data)){
            // Apaga em batches de 499 (limite seguro do Firestore)
            const snap=await getDocs(collection(db,c));
            for(let i=0;i<snap.docs.length;i+=499){ const b=writeBatch(db); snap.docs.slice(i,i+499).forEach(d=>b.delete(d.ref)); await b.commit(); }
            // Restaura em batches de 499
            for(let i=0;i<data[c].length;i+=499){ const b=writeBatch(db); data[c].slice(i,i+499).forEach(item=>{const{id,...iD}=item;b.set(doc(db,c,id),iD);}); await b.commit(); }
        }
        showNotification('success','Restaurado! Recarregando...');
        setTimeout(()=>window.location.reload(),2000);
    } catch(e){console.error(e);showNotification('error','Falha na restauração.');}
}
