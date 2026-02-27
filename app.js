// --- FIREBASE V9 MODULAR IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, updateDoc, getDocs, query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// --- CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyCn9b-Ncj5y5JQBLgutNTpgYKWTON15jgc",
    authDomain: "agenda-97604.firebaseapp.com",
    projectId: "agenda-97604",
    storageBucket: "agenda-97604.appspot.com",
    messagingSenderId: "432645254067",
    appId: "1:432645254067:web:539fa179c923ed887939c6"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- VARIÁVEIS GLOBAIS & CONFIGURAÇÃO DE UNIDADES ---
let currentUser = null, unsubscribeListeners = [], currentReportData = [];
let currentUnit = localStorage.getItem('tm_last_unit') || 'Tatuape'; // Padrão Tatuapé ou a última usada
const UNIT_COLORS = {
    'Tatuape': '#0D542B',
    'Santana': '#149C07' // Cor corrigida baseada no seu typo "1#49C07"
};
const UNIT_NAMES = {
    'Tatuape': 'Unidade Tatuapé',
    'Santana': 'Unidade Santana'
};

const COLUMN_TITLES = ['Médico 1', 'Médico 2', 'Tratamento 1', 'Tratamento 2', 'Tratamento 3'];
const CONSULTATION_TYPES = { '': '', 'Consulta': 'C', 'Nova Consulta': 'NC', 'Retorno Presencial': 'RP', 'Retorno Online': 'RO', 'Reavaliação Final': 'RVF', 'Reavaliação Meio': 'RVM' };
const RETURN_TYPES = ['Retorno Presencial', 'Retorno Online'];
const CONSULTATION_DURATIONS = { 'Consulta': 1.0, 'Nova Consulta': 1.0, 'Retorno Presencial': 0.5, 'Retorno Online': 0.5, 'Reavaliação Final': 1.0, 'Reavaliação Meio': 0.5, '': 1.0 };
let availableTags = ['Medicação', 'Reagendar', 'Agendar Próximo Mês', 'Financeiro / Nota', 'Geral'];
let professionals = { medicos: [], enfermagem: [] }, patients = [], appointments = {}, medications = [], procedures = [], observations = [];

// --- UTILITÁRIOS GLOBAIS ---
window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.formatPhoneNumber = (v) => { if(!v)return""; v=v.replace(/\D/g,'').substring(0,11); if(v.length>10)return v.replace(/(\d{2})(\d{5})(\d{4})/,"($1) $2-$3"); if(v.length>6)return v.replace(/(\d{2})(\d{4})(\d{0,4})/,"($1) $2-$3"); if(v.length>2)return v.replace(/(\d{2})(\d{0,5})/,"($1) $2"); return v.replace(/(\d*)/,"($1"); }
function showNotification(type, message, duration = 5000) { const e=document.getElementById('global-notification'); if(e){e.remove();} const s={success:'notification-success',error:'notification-error',warning:'notification-warning',info:'notification-info'}; const n=document.createElement('div'); n.id='global-notification'; n.className=`fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${s[type]||s.info} fade-in`; n.innerHTML=`<div class="flex items-center justify-between"><span>${message}</span><button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-lg">&times;</button></div>`; document.body.appendChild(n); if(duration>0){setTimeout(()=>{if(n.parentElement){n.remove();}},duration);} }
const toTitleCase = (str) => !str ? '' : str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
const getSelectedDate = () => document.getElementById('date-picker')?.value || '';
const formatDateDDMMAA = (dateStr) => { if (!dateStr) return ''; const [year, month, day] = dateStr.split('-'); return `${day}/${month}/${year.slice(-2)}`; };
function getTagColor(tagName) { const c = [{bg:'#FEF3C7',t:'#92400E'},{bg:'#DBEAFE',t:'#1E40AF'},{bg:'#D1FAE5',t:'#065F46'},{bg:'#FCE7F3',t:'#9D174D'},{bg:'#EDE9FE',t:'#5B21B6'},{bg:'#FFE4E6',t:'#BE123C'},{bg:'#DCFCE7',t:'#166534'},{bg:'#FEF7CD',t:'#854D0E'},{bg:'#E0E7FF',t:'#3730A3'},{bg:'#F0FDF4',t:'#15803D'}]; let h=0; if(!tagName)return c[0]; for(let i=0;i<tagName.length;i++){h=tagName.charCodeAt(i)+((h<<5)-h);} return c[Math.abs(h)%c.length]; }
function loadTagsConfig() { const s=localStorage.getItem('tricomaster_tags'); if(s){availableTags=JSON.parse(s);} renderTagsSummary(); }
function saveTagsConfig() { localStorage.setItem('tricomaster_tags', JSON.stringify(availableTags)); renderTagsSummary(); }

// --- FUNÇÃO DE TROCA DE UNIDADE ---
window.changeUnit = (newUnit) => {
    if (currentUnit === newUnit) return;
    currentUnit = newUnit;
    localStorage.setItem('tm_last_unit', newUnit);
    // Atualiza a interface imediatamente
    updateUnitDisplay();
    // Recarrega os dados da nova unidade
    if (currentUser) {
        setupRealtimeListeners(currentUser.uid);
        renderAgenda();
    }
    showNotification('info', `Trocado para ${UNIT_NAMES[newUnit]}`);
}

function updateUnitDisplay() {
    const unitLabel = document.getElementById('unit-label');
    const headerTitles = document.querySelectorAll('#agenda-header-titles .grid-cell');
    
    if (unitLabel) {
        unitLabel.textContent = UNIT_NAMES[currentUnit];
        unitLabel.style.color = UNIT_COLORS[currentUnit] === '#0D542B' ? 'var(--tm-gold)' : UNIT_COLORS[currentUnit]; 
        // Mantive o Dourado para Tatuapé por padrão do seu design original, 
        // mas se quiser que o texto "Unidade Tatuapé" também fique verde, mude a linha acima.
        // Se quiser que o texto siga a cor do header: unitLabel.style.color = UNIT_COLORS[currentUnit];
    }
    renderAgendaHeader(); // Recarrega os headers com a nova cor
}

// --- INICIALIZAÇÃO & AUTH ---
onAuthStateChanged(auth, user => { 
    if(user){
        currentUser=user;
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        updateUnitDisplay(); // Atualiza a exibição da unidade ao logar
        setupRealtimeListeners(user.uid);
        renderAgenda();
        loadTagsConfig();
    } else {
        currentUser=null;
        document.getElementById('app-container').classList.add('hidden');
        document.getElementById('login-container').classList.remove('hidden');
        unsubscribeListeners.forEach(u=>u());
        unsubscribeListeners=[];
    }
});

document.addEventListener('DOMContentLoaded', () => { 
    const dp=document.getElementById('date-picker'); 
    dp.value=new Date().toISOString().split('T')[0]; 
    dp.addEventListener('change', renderAgenda); 
    const tp=document.getElementById('toggle-password'),pi=document.getElementById('password'); 
    if(tp&&pi){tp.addEventListener('click',function(){const t=pi.getAttribute('type')==='password'?'text':'password';pi.setAttribute('type',t);this.querySelector('svg').innerHTML=t==='password'?'<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>':'<path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>';});} 
    document.getElementById('login-form').addEventListener('submit', (e) => { e.preventDefault(); const le=document.getElementById('login-error'); le.classList.add('hidden'); signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value).catch(err=>{le.textContent="Email ou senha inválidos.";le.classList.remove('hidden');}); }); 
    document.getElementById('logout-button').addEventListener('click', () => signOut(auth));
});

// --- REALTIME LISTENERS (COM FILTRO DE UNIDADE) ---
function setupRealtimeListeners(uid) { 
    // Limpa listeners anteriores (importante na troca de unidade)
    unsubscribeListeners.forEach(u=>u()); 
    unsubscribeListeners=[]; 
    appointments = {}; // Limpa os agendamentos locais ao trocar de unidade

    const c=['professionals','medications','procedures','patients','observations']; 
    c.forEach(coll=>{
        let q = collection(db, coll);
        if(['professionals','medications','procedures'].includes(coll)) {
            q = query(q, orderBy('name'));
        } else if(coll==='observations') {
            q = query(q, orderBy('createdAt','desc'));
        }
        unsubscribeListeners.push(onSnapshot(q, s => handleSnapshot(coll,s), e => {
            console.error(`Erro em ${coll}:`, e); 
            showNotification('error',`Erro ao carregar ${coll}.`);
        }));
    });

    // BUG FIX: Agendamentos antigos podem não ter campo 'unit'.
    // Usamos DOIS listeners: um filtrando pela unidade atual, outro buscando
    // agendamentos sem unidade (legados). Ambos alimentam o mesmo objeto local.
    const apptRef = collection(db, 'appointments');

    // Listener 1: agendamentos COM unidade correta
    const q1 = query(apptRef, where('unit', '==', currentUnit));
    unsubscribeListeners.push(onSnapshot(q1, s => {
        // Limpa apenas entradas desta unidade e recarrega
        Object.keys(appointments).forEach(k => { if (appointments[k]._source === 'unit') delete appointments[k]; });
        s.docs.forEach(d => { const a = {id: d.id, ...d.data(), _source: 'unit'}; if(a.status !== 'Excluído') appointments[d.id] = a; });
        renderAgendaContent();
    }, e => console.error('Erro appointments (unit):', e)));

    // Listener 2: agendamentos SEM campo 'unit' (legados/migração)
    // Usamos where('unit', '==', null) não funciona no Firestore para campos ausentes,
    // então buscamos todos e filtramos localmente apenas os sem unidade.
    // Para evitar custo, limitamos a busca a documentos recentes ou sem unit.
    // ATENÇÃO: depois que todos os docs tiverem 'unit', este listener retorna vazio.
    const q2 = query(apptRef, where('unit', 'not-in', ['Tatuape', 'Santana']));
    unsubscribeListeners.push(onSnapshot(q2, s => {
        Object.keys(appointments).forEach(k => { if (appointments[k]._source === 'legacy') delete appointments[k]; });
        s.docs.forEach(d => { 
            const a = {id: d.id, ...d.data(), _source: 'legacy'}; 
            if(a.status !== 'Excluído') appointments[d.id] = a;
            // Auto-migração: estampa a unidade padrão no documento legado
            if (!d.data().unit) {
                setDoc(doc(db, 'appointments', d.id), { unit: currentUnit }, { merge: true })
                    .catch(err => console.warn('Migração de unit falhou:', err));
            }
        });
        renderAgendaContent();
    }, e => console.warn('Aviso appointments (legados):', e)));
}
function handleSnapshot(coll,s){
    switch(coll){
        case'professionals':professionals={medicos:[],enfermagem:[]};s.docs.forEach(d=>{const a={id:d.id,...d.data()};if(a.role==='medicos')professionals.medicos.push(a);else professionals.enfermagem.push(a);});break;
        case'medications':medications=s.docs.map(d=>({id:d.id,...d.data()}));break;
        case'procedures':procedures=s.docs.map(d=>({id:d.id,...d.data()}));break;
        case'patients':patients=s.docs.map(d=>({id:d.id,...d.data()}));break;
        case'appointments':
            appointments={}; // Reinicia o objeto local
            s.docs.forEach(d=>{const a={id:d.id,...d.data()};if(a.status!=='Excluído'){appointments[d.id]=a;}});
            renderAgendaContent();
            break;
        case'observations':observations=s.docs.map(d=>({id:d.id,...d.data(),createdAt:d.data().createdAt?.toDate()||new Date()}));renderTagsSummary();if(!document.getElementById('modal-lista-observacoes').classList.contains('hidden')){applyObservationFilters();}break;
    }
}

// --- RENDERIZAÇÃO DA AGENDA ---
function renderAgenda() { if (!currentUser) return; updateDateDisplay(); renderAgendaHeader(); renderAgendaContent(); }
function renderAgendaHeader() { 
    const c=document.getElementById("agenda-header-titles");
    c.innerHTML="";
    // Usa a cor da unidade atual
    const color = UNIT_COLORS[currentUnit];
    c.insertAdjacentHTML("beforeend",`<div class="grid-cell h-[50px] font-bold flex items-center justify-center p-2 text-center text-sm" style="background-color:${color};color:white;">Horário</div>`);
    COLUMN_TITLES.forEach(t=>{
        c.insertAdjacentHTML("beforeend",`<div class="grid-cell h-[50px] font-bold flex items-center justify-center p-2 text-center text-sm" style="background-color:${color};color:white;">${t}</div>`);
    }); 
}
function renderAgendaContent() { const c = document.getElementById("agenda-grid-content"); if (!c) return; c.innerHTML = ""; if (!appointments || typeof appointments !== 'object') { c.innerHTML = '<div class="col-span-6 p-4 text-center text-gray-500">Carregando...</div>'; return; } const slots = generateTimeSlots(8, 19), date = getSelectedDate(); if (!date) { c.innerHTML = '<div class="col-span-6 p-4 text-center text-gray-500">Selecione data</div>'; return; } slots.forEach(t => { const r = document.createElement("div"); r.className = "contents time-row"; const tc = document.createElement("div"); tc.className = "grid-cell time-slot text-sm"; tc.textContent = t; r.appendChild(tc); COLUMN_TITLES.forEach(col => { r.appendChild(createColumnCell(col, t, date)); }); c.appendChild(r); }); }
function generateTimeSlots(s, e) { const slots = []; for (let h = s; h <= e; h++) { slots.push(`${h.toString().padStart(2, "0")}:00`); if (h < e) { slots.push(`${h.toString().padStart(2, "0")}:30`); } } return slots; }
function updateDateDisplay() { const ds = getSelectedDate(); if (!ds) return; const d = new Date(ds + 'T03:00:00'), disp = document.getElementById('current-date-display'); if (disp) { disp.innerText = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(d); } }

function createAppointmentCard(appt, sizeClass, baseTime) {
    if (!appt || typeof appt !== 'object') return '';
    let cardClass = '';
    const type = appt.consultationType;
    const isMedicoColumn = appt.column?.startsWith('Médico'); 
    if (appt.status === 'Confirmada') {
        if (isMedicoColumn) {
            if (type === 'Consulta') cardClass = 'medico-confirmada-consulta';
            else if (type === 'Nova Consulta') cardClass = 'medico-confirmada-nova-consulta';
            else if (RETURN_TYPES.includes(type)) cardClass = 'medico-confirmada-retorno';
            else if (type && type.startsWith('Reavaliação')) cardClass = 'medico-confirmada-reavaliacao';
            else cardClass = 'medico-confirmada-consulta'; 
        } else { cardClass = 'profissional-confirmada'; }
    } else if (appt.status === 'Agendada') { cardClass = 'status-agendada';
    } else if (appt.status === 'Faltou') { cardClass = 'status-faltou';
    } else if (appt.status === 'Aberta') { cardClass = 'status-aberta';
    } else if (appt.status === 'Fechada') { cardClass = 'status-fechada';
    } else { cardClass = 'status-fechada'; }
    const patientName = appt.patientName || 'Nome não informado', patientPhone = appt.patientPhone ? window.formatPhoneNumber(appt.patientPhone) : '', displayTime = appt.time;
    let content = '';
    if (appt.status === 'Fechada' || appt.status === 'Aberta') {
        content = `<div class="flex items-center justify-center h-full p-2"><strong class="text-xs truncate">${appt.observation || appt.status}</strong></div>`;
    } else {
        const obsIcon = appt.observation ? `<svg class="observation-indicator" viewBox="0 0 20 20" fill="currentColor" title="${appt.observation}"><path fill-rule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM9 9a1 1 0 11-2 0 1 1 0 012 0zm4 0a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd" /></svg>` : '';
        const items = [...(appt.procedures || []), appt.medication].filter(Boolean).join(' • ');
        let line1 = isMedicoColumn ? `<div class="text-xs flex justify-between items-center w-full"><span class="truncate flex items-center"><span class="font-bold uppercase">${appt.consultationType || ''}</span><span class="mx-2 font-light text-gray-400">|</span><span>${appt.professionalName || ''}</span></span><span class="font-bold shrink-0 ml-2">${displayTime}</span></div>` : `<div class="text-xs font-bold flex justify-between items-center w-full"><span class="truncate">${appt.professionalName || (appt.procedures && appt.procedures[0]) || ''}</span><span class="font-bold shrink-0 ml-2">${displayTime}</span></div>`;
        const line2 = `<div class="text-sm my-1"><span class="font-bold">${patientName}</span>${patientPhone ? `<span class="font-bold ml-2">${patientPhone}</span>` : ''}</div>`;
        const line3 = `<div class="text-xs text-inherit opacity-80 flex items-center gap-2 truncate"><span>${items}</span>${obsIcon}</div>`;
        content = `<div class="flex-grow flex flex-col justify-center overflow-hidden p-2">${line1}${line2}${line3}</div>`;
    }
    return `<div onclick="event.stopPropagation(); openAppointmentModal('${appt.column}', '${baseTime}', '${appt.id}')" class="appointment-card appointment-card-${sizeClass} ${cardClass}">${content}</div>`;
}
function createPlaceholderCard(column, timeToBook, baseTime, profName = '') { return `<div class="placeholder-card" onclick="event.stopPropagation(); openAppointmentModal('${column}', '${baseTime}', null, '${profName}', 'Retorno Presencial', '${timeToBook}')"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg></div>`; }
function createColumnCell(column, time, selectedDate) { const content = document.createElement("div"); content.className = "grid-cell-content"; const [hour, minuteStr] = time.split(':'); const minute = parseInt(minuteStr, 10); const firstSlotTime = `${hour}:${minute === 0 ? '00' : '30'}`, secondSlotTime = `${hour}:${minute === 0 ? '15' : '45'}`; const firstKey = `${selectedDate}-${column}-${firstSlotTime}`, secondKey = `${selectedDate}-${column}-${secondSlotTime}`; const firstAppt = appointments[firstKey], secondAppt = appointments[secondKey]; const isFirstApptFull = firstAppt && !RETURN_TYPES.includes(firstAppt.consultationType); if (isFirstApptFull) { content.innerHTML = createAppointmentCard(firstAppt, 'full', time); } else if (firstAppt && secondAppt) { content.innerHTML = createAppointmentCard(firstAppt, 'half', time); content.innerHTML += createAppointmentCard(secondAppt, 'half', time); } else if (firstAppt) { content.innerHTML = createAppointmentCard(firstAppt, 'half', time); content.innerHTML += createPlaceholderCard(column, secondSlotTime, time, firstAppt.professionalName); } else if (secondAppt) { content.innerHTML = createPlaceholderCard(column, firstSlotTime, time, secondAppt.professionalName); content.innerHTML += createAppointmentCard(secondAppt, 'half', time); } else { content.onclick = () => window.openAppointmentModal(column, time); } const cell = document.createElement("div"); cell.className = "grid-cell border-t border-l border-gray-200"; cell.appendChild(content); return cell; }

// --- MODAL AGENDAMENTO ---
window.openAppointmentModal = (col, time, id = null, profNameToPreload = '', typeToPreload = '', timeToBook = '') => { 
    const m = document.getElementById('modal-agendamento'), app = id ? appointments[id] : null, isMed = col.startsWith('Médico'), pLabel = isMed ? 'Médico' : 'Profissional'; let audit = ''; if (app && app.lastModifiedBy) { const d = app.lastModifiedAt?.toDate() || new Date(); audit = `<p class="text-xs text-gray-400 mt-4 text-center">Última modificação: ${app.lastModifiedBy} em ${d.toLocaleString('pt-BR')}</p>`; } m.innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-2xl fade-in max-h-[95vh] overflow-y-auto" role="document"><div class="flex justify-between items-center mb-6"><h2 id="modal-title" class="text-xl font-bold text-gray-800">${app ? 'Editar' : 'Novo'} Agendamento</h2><select id="appointment-status" class="form-input !w-auto !py-2"><option value="Agendada">Agendada</option><option value="Confirmada">Confirmada</option><option value="Faltou">Faltou</option><option value="Aberta">Aberta</option><option value="Fechada">Fechada</option></select></div><form id="appointment-form"><input type="hidden" id="appointment-id" value="${id || ''}"><input type="hidden" id="appointment-column" value="${col}"><input type="hidden" id="appointment-base-time" value="${time}"><div id="block-until-container" class="hidden"><div class="grid grid-cols-2 gap-4 mb-4"><div><label for="block-until-time" class="form-label">Bloquear/Desbloquear até</label><select id="block-until-time" class="form-input"></select></div><div class="flex items-end"><button type="button" id="unblock-button" class="btn btn-secondary w-full">Desbloquear até</button></div></div></div><div id="patient-info-container"><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><div class="relative"><label for="patient-name" class="form-label">Nome Paciente</label><input type="text" id="patient-name" class="form-input" required autocomplete="off"><div id="patient-search-results" class="absolute z-10 w-full bg-white border mt-1 rounded-md shadow-lg hidden max-h-48 overflow-y-auto"></div></div><div><label for="patient-phone" class="form-label">Telefone</label><input type="tel" id="patient-phone" class="form-input" maxlength="15"></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><div><label for="appointment-professional" class="form-label">${pLabel}</label><select id="appointment-professional" class="form-input"></select></div><div id="consultation-type-wrapper"><label for="appointment-consultation-type" class="form-label">Tipo Consulta</label><select id="appointment-consultation-type" class="form-input" ${!isMed ? 'disabled' : ''}></select></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><div><label class="form-label">Procedimentos</label><div id="procedures-checkbox-container" class="grid grid-cols-2 gap-2 p-3 border rounded-md max-h-40 overflow-y-auto bg-white"></div></div><div><label for="appointment-medication" class="form-label">Medicação</label><select id="appointment-medication" class="form-input"></select></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><div><label for="appointment-time" class="form-label">Horário</label><select id="appointment-time" class="form-input"></select></div><div id="return-info" class="hidden"><label class="form-label">Info</label><p class="text-sm text-gray-600 mt-2">Retornos usam 15 min. Cada slot de 30 min pode ter 2 retornos.</p></div></div></div><div class="mt-4"><label for="observation" class="form-label">Observação</label><textarea id="observation" rows="3" class="form-input"></textarea></div><div class="flex justify-between items-center mt-6"><button type="button" id="delete-button" class="text-red-600 font-semibold hover:text-red-800 transition ${!id ? 'hidden' : ''}">Excluir</button><div class="flex gap-4"><button type="button" id="cancel-button" class="btn btn-secondary">Cancelar</button><button type="submit" class="btn btn-primary">Salvar</button></div></div>${audit}</form></div>`; 
    document.getElementById('appointment-form').onsubmit = saveAppointment;
    document.getElementById('delete-button').onclick = deleteAppointment;
    document.getElementById('cancel-button').onclick = () => closeModal('modal-agendamento');
    document.getElementById('unblock-button').onclick = unblockSlots;
    populateModalDropdowns(col, time, app); 
    if (app) { 
        document.getElementById('appointment-status').value = app.status || 'Agendada'; 
        document.getElementById('patient-name').value = app.patientName || ''; 
        document.getElementById('patient-phone').value = window.formatPhoneNumber(app.patientPhone || ''); 
        document.getElementById('appointment-professional').value = app.professionalName || ''; 
        document.getElementById('appointment-consultation-type').value = app.consultationType || ''; 
        document.getElementById('appointment-medication').value = app.medication || ''; 
        document.getElementById('observation').value = app.observation || ''; 
        (app.procedures || []).forEach(p => { const cb = document.querySelector(`input[name="procedures"][value="${p}"]`); if (cb) cb.checked = true; }); 
    } else { 
        if(profNameToPreload){ document.getElementById('appointment-professional').value = profNameToPreload; } 
        if(typeToPreload){ document.getElementById('appointment-consultation-type').value = typeToPreload; } 
    } 
    handleConsultationTypeChange(); if(timeToBook) { document.getElementById('appointment-time').value = timeToBook; } 
    document.getElementById('appointment-status').addEventListener('change', handleStatusChange); 
    document.getElementById('appointment-consultation-type').addEventListener('change', handleConsultationTypeChange); 
    document.getElementById('patient-phone').addEventListener('input', e => { e.target.value = window.formatPhoneNumber(e.target.value); }); 
    document.getElementById('patient-name').addEventListener('input', showPatientSearch); 
    handleStatusChange(); 
    openModal('modal-agendamento'); 
}
function populateModalDropdowns(col, baseTime, app = null) { const profSel = document.getElementById('appointment-professional'); let profList = []; if (col.startsWith('Médico')) { profList = professionals.medicos; } else if (col === 'Tratamento 3') { profList = [...professionals.medicos, ...professionals.enfermagem]; } else { profList = professionals.enfermagem; } profSel.innerHTML = '<option value=""></option>' + profList.map(p => `<option value="${p.name}">${p.name}</option>`).join(''); const consSel = document.getElementById('appointment-consultation-type'); consSel.innerHTML = Object.keys(CONSULTATION_TYPES).map(k => `<option value="${k}">${k}</option>`).join(''); const medSel = document.getElementById('appointment-medication'); medSel.innerHTML = '<option value=""></option>' + medications.map(m => `<option value="${m.name}">${m.name}</option>`).join(''); const procCont = document.getElementById('procedures-checkbox-container'); procCont.innerHTML = procedures.map(p => `<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" name="procedures" value="${p.name}" class="rounded"> ${p.name}</label>`).join(''); handleConsultationTypeChange(); const blockSel = document.getElementById('block-until-time'); let [h, m] = baseTime.split(':').map(Number), opts = ''; while(h <= 19) { const ct = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`; opts += `<option value="${ct}">${ct}</option>`; m += 30; if (m >= 60) { h++; m = 0; } } blockSel.innerHTML = opts; blockSel.value = baseTime; if (app) { document.getElementById('appointment-time').value = app.time; } }
function handleConsultationTypeChange() { const type = document.getElementById('appointment-consultation-type').value, timeSel = document.getElementById('appointment-time'), baseTime = document.getElementById('appointment-base-time').value, retInfo = document.getElementById('return-info'); if (RETURN_TYPES.includes(type)) { const [h, m] = baseTime.split(':').map(Number); if (m === 0) { timeSel.innerHTML = `<option value="${h.toString().padStart(2, '0')}:00">${h.toString().padStart(2, '0')}:00</option><option value="${h.toString().padStart(2, '0')}:15">${h.toString().padStart(2, '0')}:15</option>`; } else { timeSel.innerHTML = `<option value="${h.toString().padStart(2, '0')}:30">${h.toString().padStart(2, '0')}:30</option><option value="${h.toString().padStart(2, '0')}:45">${h.toString().padStart(2, '0')}:45</option>`; } retInfo.classList.remove('hidden'); } else { timeSel.innerHTML = `<option value="${baseTime}">${baseTime}</option>`; retInfo.classList.add('hidden'); } }
function showPatientSearch() { const i = document.getElementById('patient-name'), r = document.getElementById('patient-search-results'); if (!i || !r) return; const st = i.value.toLowerCase(); if (st.length < 2) { r.classList.add('hidden'); return; } const fp = patients.filter(p => p.name.toLowerCase().includes(st)); r.innerHTML = fp.slice(0, 5).map(p => `<div class="p-2 hover:bg-gray-100 cursor-pointer border-b" onclick="selectPatient('${p.name}', '${p.phone || ''}')"><div class="font-medium">${p.name}</div>${p.phone ? `<div class="text-xs text-gray-600">${window.formatPhoneNumber(p.phone)}</div>` : ''}</div>`).join(''); r.classList.remove('hidden'); }
window.selectPatient = (n, p) => { document.getElementById('patient-name').value = n; document.getElementById('patient-phone').value = window.formatPhoneNumber(p); document.getElementById('patient-search-results').classList.add('hidden'); }
function handleStatusChange() { const s = document.getElementById('appointment-status').value, bc = document.getElementById('block-until-container'), pc = document.getElementById('patient-info-container'), pne = document.getElementById('patient-name'); if (s === 'Fechada' || s === 'Aberta') { bc.classList.remove('hidden'); pc.classList.add('hidden'); pne.required = false; } else { bc.classList.add('hidden'); pc.classList.remove('hidden'); pne.required = true; } }
async function saveAppointment(e) { e.preventDefault(); const s = document.getElementById('appointment-status').value; if (s === 'Fechada' || s === 'Aberta') { await saveBlockedSlots(s); return; } const id = document.getElementById('appointment-id').value, t = document.getElementById('appointment-time').value, c = document.getElementById('appointment-column').value, procs = Array.from(document.querySelectorAll('input[name="procedures"]:checked')).map(cb => cb.value), pn = toTitleCase(document.getElementById('patient-name').value.trim()), pp = document.getElementById('patient-phone').value.replace(/\D/g,'');

    // BUG FIX: A chave sempre é baseada em data+coluna+horário.
    // Se o usuário editou e mudou o horário, a chave nova é diferente da antiga (id).
    // Nesse caso: exclui o documento antigo e cria o novo com a chave correta.
    const newKey = `${getSelectedDate()}-${c}-${t}`;
    const oldKey = id || newKey;
    const keyChanged = id && id !== newKey;

    const ad = { status: s, patientName: pn, patientPhone: pp, professionalName: document.getElementById('appointment-professional').value, consultationType: document.getElementById('appointment-consultation-type').value, medication: document.getElementById('appointment-medication').value, procedures: procs, observation: document.getElementById('observation').value.trim(), date: getSelectedDate(), time: t, column: c, unit: currentUnit, lastModifiedBy: currentUser.email, lastModifiedAt: serverTimestamp() };
    if (!id) { ad.createdBy = currentUser.email; ad.createdAt = serverTimestamp(); ad.userId = currentUser.uid; } else { // Preserva dados de criação ao editar
        const existing = appointments[oldKey]; if (existing) { ad.createdBy = existing.createdBy || currentUser.email; ad.createdAt = existing.createdAt || serverTimestamp(); ad.userId = existing.userId || currentUser.uid; }
    }
    try { const pq = await getDocs(query(collection(db, 'patients'), where('name', '==', pn), limit(1))); if (pq.empty) { await addDoc(collection(db, 'patients'), { name: pn, phone: pp, userId: currentUser.uid }); } else { if (pq.docs[0].data().phone !== pp) await updateDoc(doc(db, 'patients', pq.docs[0].id), { phone: pp }); }
        if (keyChanged) {
            // Horário foi alterado: remove o documento antigo e salva com nova chave
            const batch = writeBatch(db);
            batch.delete(doc(db, 'appointments', oldKey));
            batch.set(doc(db, 'appointments', newKey), ad);
            await batch.commit();
        } else {
            await setDoc(doc(db, 'appointments', newKey), ad, { merge: true });
        }
        showNotification('success', 'Agendamento salvo!'); closeModal('modal-agendamento'); } catch (err) { console.error("Erro:", err); showNotification('error', 'Erro ao salvar.'); } }
async function saveBlockedSlots(s) { const st = document.getElementById('appointment-time').value, et = document.getElementById('block-until-time').value, c = document.getElementById('appointment-column').value, d = getSelectedDate(), o = document.getElementById('observation').value || s; let ct = new Date(`${d}T${st}`); const end = new Date(`${d}T${et}`), batch = writeBatch(db); while(ct <= end) { const ts = `${ct.getHours().toString().padStart(2,'0')}:${ct.getMinutes().toString().padStart(2,'0')}`; batch.set(doc(db, 'appointments', `${d}-${c}-${ts}`), { status: s, observation: o, date: d, time: ts, column: c, unit: currentUnit, userId: currentUser.uid, createdBy: currentUser.email, createdAt: serverTimestamp(), lastModifiedBy: currentUser.email, lastModifiedAt: serverTimestamp() }); ct.setMinutes(ct.getMinutes() + 15); } try { await batch.commit(); showNotification('success', 'Horários bloqueados!'); closeModal('modal-agendamento'); } catch (err) { console.error("Erro:", err); showNotification('error', 'Erro ao bloquear.'); } }
async function unblockSlots() { if(!confirm('DESBLOQUEAR horários? Cards "Aberta" e "Fechada" serão removidos.')) return; const st = document.getElementById('appointment-base-time').value, et = document.getElementById('block-until-time').value, c = document.getElementById('appointment-column').value, d = getSelectedDate(); let ct = new Date(`${d}T${st}`); const end = new Date(`${d}T${et}`), batch = writeBatch(db); while(ct <= end) { const ts = `${ct.getHours().toString().padStart(2,'0')}:${ct.getMinutes().toString().padStart(2,'0')}`, k = `${d}-${c}-${ts}`; if (appointments[k] && ['Aberta','Fechada'].includes(appointments[k].status)) batch.delete(doc(db, 'appointments', k)); ct.setMinutes(ct.getMinutes() + 15); } try { await batch.commit(); showNotification('success', 'Horários desbloqueados!'); closeModal('modal-agendamento'); } catch (err) { console.error("Erro:", err); showNotification('error', 'Erro ao desbloquear.'); } }
function deleteAppointment() { const k = document.getElementById('appointment-id').value; if (k && confirm('Tem certeza?')) { setDoc(doc(db, 'appointments', k), { status: 'Excluído', deletedBy: currentUser.email, deletedAt: serverTimestamp(), lastModifiedBy: currentUser.email, lastModifiedAt: serverTimestamp() }, { merge: true }).then(() => { showNotification('success', 'Excluído!'); closeModal('modal-agendamento'); }).catch(err => { console.error(err); showNotification('error', 'Erro ao excluir.'); }); } }

// --- CADASTROS ---
window.toggleAccordion = (button) => { button.nextElementSibling.classList.toggle('open'); button.querySelector('.accordion-arrow').classList.toggle('open'); }
window.openCadastrosWithPassword = () => { const p = prompt("Insira a senha para acessar:"); if (p === "1970") openCadastrosModal(); else if (p !== null) alert("Senha incorreta!"); }
function openCadastrosModal() { 
    const m=document.getElementById('modal-cadastros'); 
    m.innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-2xl fade-in max-h-[95vh] overflow-y-auto"><div class="flex justify-between items-center mb-4"><h2 class="text-2xl font-bold text-gray-800">Cadastros</h2><button type="button" onclick="closeModal('modal-cadastros')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div><div class="space-y-2"><div class="border rounded-lg"><button onclick="toggleAccordion(this)" class="w-full flex justify-between items-center p-4 font-semibold text-lg"><span class="text-tm-text-primary">Médicos</span><svg class="w-5 h-5 accordion-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div class="accordion-content px-4"><div class="flex gap-2 mb-4"><input type="text" id="new-medico-name" placeholder="Nome do Médico" class="form-input flex-1"><button id="add-medico-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="medicos-list" class="max-h-60 overflow-y-auto space-y-2">${renderMedicosList()}</div></div></div><div class="border rounded-lg"><button onclick="toggleAccordion(this)" class="w-full flex justify-between items-center p-4 font-semibold text-lg"><span class="text-tm-text-primary">Profissionais (Enfermagem)</span><svg class="w-5 h-5 accordion-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div class="accordion-content px-4"><div class="flex gap-2 mb-4"><input type="text" id="new-enfermagem-name" placeholder="Nome do Profissional" class="form-input flex-1"><button id="add-enfermagem-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="enfermagem-list" class="max-h-60 overflow-y-auto space-y-2">${renderEnfermagemList()}</div></div></div><div class="border rounded-lg"><button onclick="toggleAccordion(this)" class="w-full flex justify-between items-center p-4 font-semibold text-lg"><span class="text-tm-text-primary">Procedimentos</span><svg class="w-5 h-5 accordion-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div class="accordion-content px-4"><div class="flex gap-2 mb-4"><input type="text" id="new-procedure-name" placeholder="Nome do Procedimento" class="form-input flex-1"><button id="add-procedure-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="procedures-list" class="max-h-60 overflow-y-auto space-y-2">${renderProceduresList()}</div></div></div><div class="border rounded-lg"><button onclick="toggleAccordion(this)" class="w-full flex justify-between items-center p-4 font-semibold text-lg"><span class="text-tm-text-primary">Medicações</span><svg class="w-5 h-5 accordion-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div class="accordion-content px-4"><div class="flex gap-2 mb-4"><input type="text" id="new-medication-name" placeholder="Nome da Medicação" class="form-input flex-1"><button id="add-medication-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="medications-list" class="max-h-60 overflow-y-auto space-y-2">${renderMedicationsList()}</div></div></div><div class="border rounded-lg"><button onclick="toggleAccordion(this)" class="w-full flex justify-between items-center p-4 font-semibold text-lg"><span class="text-tm-text-primary">Tags de Observação</span><svg class="w-5 h-5 accordion-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div class="accordion-content px-4"><div class="flex gap-2 mb-4"><input type="text" id="new-tag-name" placeholder="Nome da Tag" class="form-input flex-1"><button id="add-tag-btn" class="btn btn-primary !px-4 !py-2">Adicionar</button></div><div id="tags-list" class="max-h-60 overflow-y-auto space-y-2">${renderTagsList()}</div></div></div></div></div>`; 
    document.getElementById('add-medico-btn').onclick = () => addProfessional('medicos');
    document.getElementById('add-enfermagem-btn').onclick = () => addProfessional('enfermagem');
    document.getElementById('add-procedure-btn').onclick = addProcedure;
    document.getElementById('add-medication-btn').onclick = addMedication;
    document.getElementById('add-tag-btn').onclick = addTag;
    openModal('modal-cadastros');
}
function renderMedicosList() { return professionals.medicos.map(p => `<div class="flex justify-between items-center p-2 border-b"><span>${p.name}</span><button onclick="deleteProfessional('${p.id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join(''); }
function renderEnfermagemList() { return professionals.enfermagem.map(p => `<div class="flex justify-between items-center p-2 border-b"><span>${p.name}</span><button onclick="deleteProfessional('${p.id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join(''); }
function renderMedicationsList() { return medications.map(m => `<div class="flex justify-between items-center p-2 border-b"><span>${m.name}</span><button onclick="deleteMedication('${m.id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join(''); }
function renderProceduresList() { return procedures.map(p => `<div class="flex justify-between items-center p-2 border-b"><span>${p.name}</span><button onclick="deleteProcedure('${p.id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join(''); }
function renderTagsList() { return [...availableTags].sort((a, b) => a.localeCompare(b)).map(t => `<div class="flex justify-between items-center p-2 border-b"><span>${t}</span><button onclick="deleteTag('${t}')" class="text-red-500 hover:text-red-700 text-sm ml-2">Excluir</button></div>`).join(''); }
async function addProfessional(role) { const inputId = role === 'medicos' ? 'new-medico-name' : 'new-enfermagem-name'; const name = document.getElementById(inputId).value.trim(); if (!name) return showNotification('error', 'Digite o nome.'); try { await addDoc(collection(db, 'professionals'), { name, role, userId: currentUser.uid, createdAt: serverTimestamp() }); document.getElementById(inputId).value = ''; showNotification('success', 'Adicionado!'); } catch (e) { console.error(e); showNotification('error', 'Erro ao adicionar.'); } }
async function addMedication() { const name = document.getElementById('new-medication-name').value.trim(); if (!name) return showNotification('error', 'Digite o nome.'); try { await addDoc(collection(db, 'medications'), { name, userId: currentUser.uid, createdAt: serverTimestamp() }); document.getElementById('new-medication-name').value = ''; showNotification('success', 'Adicionada!'); } catch (e) { console.error(e); showNotification('error', 'Erro.'); } }
async function addProcedure() { const name = document.getElementById('new-procedure-name').value.trim(); if (!name) return showNotification('error', 'Digite o nome.'); try { await addDoc(collection(db, 'procedures'), { name, userId: currentUser.uid, createdAt: serverTimestamp() }); document.getElementById('new-procedure-name').value = ''; showNotification('success', 'Adicionado!'); } catch (e) { console.error(e); showNotification('error', 'Erro.'); } }
function addTag() { const name = document.getElementById('new-tag-name').value.trim(); if (!name) return showNotification('error', 'Digite a tag.'); if (availableTags.includes(name)) return showNotification('warning', 'Tag já existe.'); availableTags.push(name); availableTags.sort((a, b) => a.localeCompare(b)); saveTagsConfig(); document.getElementById('new-tag-name').value = ''; showNotification('success', 'Adicionada!'); document.getElementById('tags-list').innerHTML = renderTagsList(); }
window.deleteProfessional = async (id) => { if (confirm('Excluir profissional?')) { try { await deleteDoc(doc(db, 'professionals', id)); showNotification('success', 'Excluído!'); } catch (e) { console.error(e); showNotification('error', 'Erro ao excluir.'); } } }
window.deleteMedication = async (id) => { if (confirm('Excluir medicação?')) { try { await deleteDoc(doc(db, 'medications', id)); showNotification('success', 'Excluída!'); } catch (e) { console.error(e); showNotification('error', 'Erro ao excluir.'); } } }
window.deleteProcedure = async (id) => { if (confirm('Excluir procedimento?')) { try { await deleteDoc(doc(db, 'procedures', id)); showNotification('success', 'Excluído!'); } catch (e) { console.error(e); showNotification('error', 'Erro ao excluir.'); } } }
window.deleteTag = (tagName) => { if (confirm('Excluir tag?')) { availableTags = availableTags.filter(t => t !== tagName); saveTagsConfig(); showNotification('success', 'Excluída!'); document.getElementById('tags-list').innerHTML = renderTagsList(); } }

// --- OBSERVAÇÕES ---
window.openObservationsModal = () => { 
    const modal=document.getElementById('modal-lista-observacoes'); 
    const tagsHTML=availableTags.map(tag=>`<span class="tag modal-tag" style="background-color:${getTagColor(tag).bg};color:${getTagColor(tag).text}" data-tag="${tag}" onclick="toggleTagSelection(this)">${tag}</span>`).join(''); 
    const tagFilterOptions='<option value="">Todas as Tags</option>'+[...availableTags].sort((a,b)=>a.localeCompare(b)).map(tag=>`<option value="${tag}">${tag}</option>`).join(''); 
    const today=new Date(),year=today.getFullYear(),month=String(today.getMonth()+1).padStart(2,'0'),defaultMonth=`${year}-${month}`; 
    modal.innerHTML=`<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-4xl fade-in max-h-[95vh] overflow-y-auto"><div class="flex justify-between items-center mb-6"><h2 class="text-2xl font-bold">Observação</h2><button type="button" onclick="closeModal('modal-lista-observacoes')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div><div class="space-y-4"><textarea id="observation-text" rows="3" class="form-input" placeholder="Digite sua observação..."></textarea><div><button onclick="openTagsConfigModal()" class="btn btn-secondary !py-1 !px-3 text-xs mb-2">Gerenciar Tags</button><div id="modal-tags-selection-container" class="flex flex-wrap gap-2 py-2">${tagsHTML}</div></div><div class="flex justify-end pt-4 border-t"><button id="save-observation-btn" class="btn btn-primary">Salvar Observação</button></div><div class="border-t pt-4"><h3 class="text-lg font-bold mb-4">Observações Recentes</h3><div class="flex items-center gap-4 mb-4"><input type="month" id="obs-filter-month" class="form-input w-48" value="${defaultMonth}"><select id="obs-filter-tag" class="form-input flex-1">${tagFilterOptions}</select></div><div id="observations-list-container" class="space-y-3 max-h-80 overflow-y-auto invisible-scrollbar"></div></div></div></div>`; 
    document.getElementById('save-observation-btn').onclick = saveObservation;
    document.getElementById('obs-filter-month').onchange = applyObservationFilters;
    document.getElementById('obs-filter-tag').onchange = applyObservationFilters;
    openModal('modal-lista-observacoes'); applyObservationFilters(); 
}
window.toggleTagSelection = (el) => el.classList.toggle('selected-tag');
function applyObservationFilters(){const m=document.getElementById('obs-filter-month')?.value,t=document.getElementById('obs-filter-tag')?.value;let f=[...observations];if(m){const[y,o]=m.split('-');f=f.filter(obs=>{const d=obs.createdAt;return d.getFullYear()==y&&(d.getMonth()+1)==o;});}if(t){f=f.filter(obs=>obs.tags&&obs.tags.includes(t));}const c=document.getElementById('observations-list-container');if(c)c.innerHTML=renderObservationsList(f);}
function renderObservationsList(obsToRender=[]){if(obsToRender.length===0){return'<p class="text-gray-500 text-center py-4">Nenhuma observação encontrada.</p>';}return obsToRender.map(obs=>{const d=obs.createdAt?.toLocaleDateString?.('pt-BR')||'Data indisponível',tags=obs.tags||[];return`<div class="p-3 border rounded-lg bg-white shadow-sm"><div class="flex justify-between items-start mb-2"><div class="flex flex-wrap gap-1 mb-2">${tags.map(t=>`<span class="tag text-xs" style="background-color:${getTagColor(t).bg};color:${getTagColor(t).text}">${t}</span>`).join('')}</div><span class="text-xs text-gray-500 shrink-0 ml-2">${d}</span></div><p class="text-gray-700 break-words">${obs.text}</p><div class="flex justify-between items-center mt-2"><span class="text-xs text-gray-500">Por: ${obs.createdBy||'Usuário'}</span><button onclick="deleteObservation('${obs.id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div></div>`;}).join('');}
async function saveObservation(){ const t=document.getElementById('observation-text').value.trim(); const sE=document.querySelectorAll('#modal-tags-selection-container .selected-tag'); const sT=Array.from(sE).map(el=>el.dataset.tag); if(!t){return showNotification('error','Digite a observação.');} try{ await addDoc(collection(db, 'observations'), { text:t, tags:sT, createdBy:currentUser.email, userId:currentUser.uid, createdAt: serverTimestamp() }); document.getElementById('observation-text').value=''; sE.forEach(el=>el.classList.remove('selected-tag')); showNotification('success','Observação salva!'); }catch(e){console.error("Erro:",e);showNotification('error','Erro ao salvar.');} }
window.deleteObservation = async (id) => { if(confirm('Excluir observação?')){ try{ await deleteDoc(doc(db, 'observations', id)); showNotification('success','Excluída!'); }catch(e){console.error("Erro:",e);showNotification('error','Erro ao excluir.');} } }
function renderTagsSummary(){const c=document.getElementById('tags-container');if(!c)return;const counts={};observations.forEach(o=>{(o.tags||[]).forEach(t=>{counts[t]=(counts[t]||0)+1;});});let h='';const sorted=Object.keys(counts).sort();for(const tag of sorted){const count=counts[tag];if(count>0){const color=getTagColor(tag);h+=`<span class="tag cursor-pointer" style="background-color:${color.bg};color:${color.text}" onclick="filterByTag('${tag}')">${tag} (${count})</span>`;}}c.innerHTML=h||'<p class="text-sm text-gray-500">Nenhuma tag utilizada.</p>';}
window.filterByTag = (tag) => { openObservationsModal(); setTimeout(()=>{ const s=document.getElementById('obs-filter-tag'); if(s){s.value=tag;applyObservationFilters();} },100); }
window.openTagsConfigModal = () => { 
    const m=document.getElementById('modal-tags-config'); 
    m.innerHTML=`<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md fade-in"><div class="flex justify-between items-center mb-6"><h2 class="text-xl font-bold">Configurar Tags</h2><button type="button" onclick="closeModal('modal-tags-config')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div><div class="space-y-4"><div class="flex gap-2"><input type="text" id="new-config-tag" placeholder="Nova tag" class="form-input flex-1"><button id="add-config-tag-btn" class="btn btn-primary">Add</button></div><div id="config-tags-list" class="max-h-60 overflow-y-auto space-y-2">${[...availableTags].sort((a,b)=>a.localeCompare(b)).map(t=>`<div class="flex justify-between items-center p-2 border rounded"><span class="tag" style="background-color:${getTagColor(t).bg};color:${getTagColor(t).text}">${t}</span><button onclick="removeConfigTag('${t}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join('')}</div><div class="flex gap-2 pt-4"><button onclick="closeModal('modal-tags-config')" class="btn btn-secondary flex-1">Cancelar</button><button id="save-tags-config-btn" class="btn btn-primary flex-1">Salvar</button></div></div></div>`; 
    document.getElementById('add-config-tag-btn').onclick = addConfigTag;
    document.getElementById('save-tags-config-btn').onclick = saveTagsConfigAndClose;
    openModal('modal-tags-config');
}
function addConfigTag(){ const i=document.getElementById('new-config-tag'),t=i.value.trim(); if(!t)return showNotification('error','Digite a tag'); if(availableTags.includes(t))return showNotification('warning','Tag já existe'); availableTags.push(t); document.getElementById('config-tags-list').innerHTML=[...availableTags].sort((a,b)=>a.localeCompare(b)).map(tag=>`<div class="flex justify-between items-center p-2 border rounded"><span class="tag" style="background-color:${getTagColor(tag).bg};color:${getTagColor(tag).text}">${tag}</span><button onclick="removeConfigTag('${t}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join(''); i.value=''; }
window.removeConfigTag = (t) => { availableTags=availableTags.filter(tag=>tag!==t); document.getElementById('config-tags-list').innerHTML=[...availableTags].sort((a,b)=>a.localeCompare(b)).map(tag=>`<div class="flex justify-between items-center p-2 border rounded"><span class="tag" style="background-color:${getTagColor(tag).bg};color:${getTagColor(tag).text}">${tag}</span><button onclick="removeConfigTag('${t}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button></div>`).join(''); }
function saveTagsConfigAndClose(){ saveTagsConfig(); closeModal('modal-tags-config'); if(!document.getElementById('modal-lista-observacoes').classList.contains('hidden')){ openObservationsModal(); } showNotification('success','Tags salvas!'); }

// --- DASHBOARD & RELATÓRIOS ---
window.openDashboardModal = () => { 
    const modal = document.getElementById('modal-dashboard'); 
    const today = new Date(); const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]; const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]; 
    modal.innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-6xl fade-in max-h-[95vh] overflow-y-auto"><div class="flex justify-between items-center mb-6"><h2 class="text-2xl font-bold text-gray-800">Dashboard</h2><button type="button" onclick="closeModal('modal-dashboard')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div><label class="form-label">Data Início</label><input type="date" id="dashboard-start-date" class="form-input" value="${firstDay}"></div><div><label class="form-label">Data Final</label><input type="date" id="dashboard-end-date" class="form-input" value="${lastDay}"></div></div><div class="flex gap-4 mb-6"><button id="dashboard-medicos-btn" class="btn btn-primary flex-1">Dashboard Médicos</button><button id="dashboard-enfermagem-btn" class="btn btn-secondary flex-1">Dashboard Enfermagem</button></div><div id="dashboard-content"><div class="text-center text-gray-500 py-8">Selecione as datas e um tipo de dashboard para visualizar.</div></div></div>`; 
    document.getElementById('dashboard-medicos-btn').onclick = showMedicosDashboard;
    document.getElementById('dashboard-enfermagem-btn').onclick = showEnfermagemDashboard;
    openModal('modal-dashboard'); 
}
function showMedicosDashboard() {
    const startDate = document.getElementById('dashboard-start-date').value; const endDate = document.getElementById('dashboard-end-date').value; if (!startDate || !endDate) { showNotification('error', 'Selecione as datas.'); return; }
    const start = new Date(startDate + 'T00:00:00'), end = new Date(endDate + 'T23:59:59');
    const medicosAppointments = Object.values(appointments).filter(apt => { const d = new Date(apt.date + 'T00:00:00'); return d >= start && d <= end && apt.status !== 'Excluído' && apt.status !== 'Fechada' && apt.status !== 'Aberta' && apt.column?.startsWith('Médico'); });
    const totalConfirmadosGeral = medicosAppointments.filter(a => a.status === 'Confirmada').length;
    const totalAgendado = medicosAppointments.length, faltas = medicosAppointments.filter(a => a.status === 'Faltou').length;
    const taxaComparecimento = totalAgendado > 0 ? ((totalConfirmadosGeral / totalAgendado) * 100).toFixed(1) : 0;
    const analisePorTipo = {}; medicosAppointments.forEach(apt => { const tipo = apt.consultationType || 'Consulta'; if (!analisePorTipo[tipo]) { analisePorTipo[tipo] = { total: 0, confirmados: 0, faltas: 0 }; } analisePorTipo[tipo].total++; if (apt.status === 'Confirmada') analisePorTipo[tipo].confirmados++; if (apt.status === 'Faltou') analisePorTipo[tipo].faltas++; });
    const analisePorProcedimento = {}; medicosAppointments.forEach(apt => { const procs = apt.procedures || []; if (procs.length === 0) { const key = 'Sem procedimento'; if (!analisePorProcedimento[key]) { analisePorProcedimento[key] = { total: 0, confirmados: 0, faltas: 0 }; } analisePorProcedimento[key].total++; if (apt.status === 'Confirmada') analisePorProcedimento[key].confirmados++; if (apt.status === 'Faltou') analisePorProcedimento[key].faltas++; } else { procs.forEach(p => { if (!analisePorProcedimento[p]) { analisePorProcedimento[p] = { total: 0, confirmados: 0, faltas: 0 }; } analisePorProcedimento[p].total++; if (apt.status === 'Confirmada') analisePorProcedimento[p].confirmados++; if (apt.status === 'Faltou') analisePorProcedimento[p].faltas++; }); } });
    const analisePorMedico = {}; medicosAppointments.forEach(apt => { if (apt.professionalName) { const m = apt.professionalName; if (!analisePorMedico[m]) { analisePorMedico[m] = { consultas: 0, confirmados: 0, faltas: 0, horasTrabalhadas: 0, tiposConsulta: {} }; } analisePorMedico[m].consultas++; if (apt.status === 'Confirmada') analisePorMedico[m].confirmados++; if (apt.status === 'Faltou') analisePorMedico[m].faltas++; const duracao = CONSULTATION_DURATIONS[apt.consultationType] || 1.0; analisePorMedico[m].horasTrabalhadas += duracao; const tipo = apt.consultationType || 'Consulta'; analisePorMedico[m].tiposConsulta[tipo] = (analisePorMedico[m].tiposConsulta[tipo] || 0) + 1; } });
    Object.keys(analisePorMedico).forEach(m => { analisePorMedico[m].percentualTotal = totalAgendado > 0 ? ((analisePorMedico[m].consultas / totalAgendado) * 100).toFixed(1) : 0; });
    const abbreviations = {'Consulta':'CT','Nova Consulta':'NC','Retorno Presencial':'RT','Retorno Online':'RT','Reavaliação Final':'RV','Reavaliação Meio':'RV'};
    const dashboardContent = document.getElementById('dashboard-content');
    dashboardContent.innerHTML = `<div class="space-y-6"><div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Visão Geral - Médicos</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-4"><div class="stat-card"><div class="stat-number">${totalAgendado}</div><div class="stat-label">Total Agendado</div></div><div class="stat-card"><div class="stat-number">${totalConfirmadosGeral}</div><div class="stat-label">Confirmados</div></div><div class="stat-card"><div class="stat-number">${faltas}</div><div class="stat-label">Faltas</div></div><div class="stat-card"><div class="stat-number">${taxaComparecimento}%</div><div class="stat-label">Taxa de Comparecimento</div></div></div></div><div class="dashboard-card"><h3 class="text-lg font-bold mb-4">AGENDA MÉDICA</h3><div class="mb-6"><h4 class="font-semibold mb-3">Por Tipo de Consulta</h4><div class="table-responsive invisible-scrollbar"><table class="data-table"><thead><tr><th>Tipo</th><th>Total</th><th>Conf.</th><th>Faltas</th><th>Comp. %</th><th>% Conf.</th></tr></thead><tbody>${Object.entries(analisePorTipo).map(([tipo, d]) => `<tr><td>${tipo}</td><td>${d.total}</td><td>${d.confirmados}</td><td>${d.faltas}</td><td>${d.total > 0 ? `${((d.confirmados / d.total) * 100).toFixed(1)}%` : '0%'}</td><td>${totalConfirmadosGeral > 0 ? `${((d.confirmados / totalConfirmadosGeral) * 100).toFixed(1)}%` : '0%'}</td></tr>`).join('')}</tbody></table></div></div><div><h4 class="font-semibold mb-3">Por Procedimento</h4><div class="table-responsive max-h-80 overflow-y-auto invisible-scrollbar"><table class="data-table"><thead><tr><th>Procedimento</th><th>Total</th><th>Conf.</th><th>Faltas</th></tr></thead><tbody>${Object.entries(analisePorProcedimento).map(([p, d]) => `<tr><td>${p}</td><td>${d.total}</td><td>${d.confirmados}</td><td>${d.faltas}</td></tr>`).join('')}</tbody></table></div></div></div><div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Análise por Médico</h3><div class="table-responsive invisible-scrollbar"><table class="data-table"><thead><tr><th>Médico</th><th>Consultas</th><th>% Total</th><th>Conf.</th><th>Faltas</th><th>Comp. %</th><th>Horas Trab.</th><th>Tipos de Consulta</th></tr></thead><tbody>${Object.entries(analisePorMedico).map(([m, d]) => `<tr><td>${m}</td><td>${d.consultas}</td><td>${d.percentualTotal}%</td><td>${d.confirmados}</td><td>${d.faltas}</td><td>${d.consultas > 0 ? `${((d.confirmados / d.consultas) * 100).toFixed(1)}%` : '0%'}</td><td>${d.horasTrabalhadas.toFixed(1)}h</td><td class="text-xs">${Object.entries(d.tiposConsulta).map(([t, c]) => `${abbreviations[t] || t}: ${c}`).join(', ')}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}
function showEnfermagemDashboard() { 
    const startDate = document.getElementById('dashboard-start-date').value; const endDate = document.getElementById('dashboard-end-date').value; if (!startDate || !endDate) { showNotification('error', 'Selecione as datas.'); return; } const start = new Date(startDate + 'T00:00:00'), end = new Date(endDate + 'T23:59:59'); const enfermagemAppointments = Object.values(appointments).filter(apt => { const d = new Date(apt.date + 'T00:00:00'); return d >= start && d <= end && apt.status !== 'Excluído' && apt.status !== 'Fechada' && apt.status !== 'Aberta' && !apt.column?.startsWith('Médico'); }); const totalAgendado = enfermagemAppointments.length, confirmados = enfermagemAppointments.filter(a => a.status === 'Confirmada').length, faltas = enfermagemAppointments.filter(a => a.status === 'Faltou').length; const taxaComparecimento = totalAgendado > 0 ? ((confirmados / totalAgendado) * 100).toFixed(1) : 0; const analisePorProcedimento = {}; enfermagemAppointments.forEach(apt => { const procs = apt.procedures || ['Sem procedimento']; procs.forEach(p => { if (!analisePorProcedimento[p]) { analisePorProcedimento[p] = { total: 0, confirmados: 0, faltas: 0 }; } analisePorProcedimento[p].total++; if (apt.status === 'Confirmada') analisePorProcedimento[p].confirmados++; if (apt.status === 'Faltou') analisePorProcedimento[p].faltas++; }); }); const analisePorProfissional = {}; enfermagemAppointments.forEach(apt => { if (apt.professionalName) { const p = apt.professionalName; if (!analisePorProfissional[p]) { analisePorProfissional[p] = { atendimentos: 0, confirmados: 0, faltas: 0, horasTrabalhadas: 0, procedimentos: {} }; } analisePorProfissional[p].atendimentos++; if (apt.status === 'Confirmada') analisePorProfissional[p].confirmados++; if (apt.status === 'Faltou') analisePorProfissional[p].faltas++; analisePorProfissional[p].horasTrabalhadas += 1.0; const procs = apt.procedures || ['Sem procedimento']; procs.forEach(proc => { analisePorProfissional[p].procedimentos[proc] = (analisePorProfissional[p].procedimentos[proc] || 0) + 1; }); } }); Object.keys(analisePorProfissional).forEach(p => { analisePorProfissional[p].percentualTotal = totalAgendado > 0 ? ((analisePorProfissional[p].atendimentos / totalAgendado) * 100).toFixed(1) : 0; }); const dashboardContent = document.getElementById('dashboard-content'); dashboardContent.innerHTML = `<div class="space-y-6"><div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Visão Geral - Enfermagem</h3><div class="grid grid-cols-2 md:grid-cols-4 gap-4"><div class="stat-card-enfermagem"><div class="stat-number">${totalAgendado}</div><div class="stat-label">Total Agendado</div></div><div class="stat-card-enfermagem"><div class="stat-number">${confirmados}</div><div class="stat-label">Confirmados</div></div><div class="stat-card-enfermagem"><div class="stat-number">${faltas}</div><div class="stat-label">Faltas</div></div><div class="stat-card-enfermagem"><div class="stat-number">${taxaComparecimento}%</div><div class="stat-label">Taxa de Comparecimento</div></div></div></div><div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Análise por Procedimento</h3><div class="table-responsive invisible-scrollbar"><table class="data-table"><thead><tr><th>Procedimento</th><th>Total Agendado</th><th>Conf.</th><th>Faltas</th><th>Comp. %</th></tr></thead><tbody>${Object.entries(analisePorProcedimento).map(([p, d]) => `<tr><td>${p}</td><td>${d.total}</td><td>${d.confirmados}</td><td>${d.faltas}</td><td>${d.total > 0 ? `${((d.confirmados / d.total) * 100).toFixed(1)}%` : '0%'}</td></tr>`).join('')}</tbody></table></div></div><div class="dashboard-card"><h3 class="text-lg font-bold mb-4">Análise por Profissional</h3><div class="table-responsive invisible-scrollbar"><table class="data-table"><thead><tr><th>Profissional</th><th>Atendimentos</th><th>% Total</th><th>Conf.</th><th>Faltas</th><th>Comp. %</th><th>Horas Trab.</th><th>Procedimentos Realizados</th></tr></thead><tbody>${Object.entries(analisePorProfissional).map(([p, d]) => `<tr><td>${p}</td><td>${d.atendimentos}</td><td>${d.percentualTotal}%</td><td>${d.confirmados}</td><td>${d.faltas}</td><td>${d.atendimentos > 0 ? `${((d.confirmados / d.atendimentos) * 100).toFixed(1)}%` : '0%'}</td><td>${d.horasTrabalhadas.toFixed(1)}h</td><td class="text-xs">${Object.entries(d.procedimentos).map(([proc, c]) => `${proc}: ${c}`).join(', ')}</td></tr>`).join('')}</tbody></table></div></div></div>`; 
}
window.openReportsModal = () => { 
    const modal = document.getElementById('modal-relatorios'); 
    const today = new Date(); const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]; const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]; 
    modal.innerHTML = `<div class="bg-white rounded-lg shadow-2xl p-6 w-full max-w-7xl fade-in max-h-[95vh] overflow-y-auto"><div class="flex justify-between items-center mb-6"><h2 class="text-2xl font-bold text-gray-800">Gerador de Relatórios</h2><button type="button" onclick="closeModal('modal-relatorios')" class="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div><div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6"><div><label class="form-label">Data Início</label><input type="date" id="report-start-date" class="form-input" value="${firstDay}"></div><div><label class="form-label">Data Final</label><input type="date" id="report-end-date" class="form-input" value="${lastDay}"></div><div><label class="form-label">Profissional</label><select id="report-professional" class="form-input"><option value="Todos">Todos</option>${[...professionals.medicos, ...professionals.enfermagem].map(p => `<option value="${p.name}">${p.name}</option>`).join('')}</select></div><div><label class="form-label">Consulta</label><select id="report-consultation-type" class="form-input"><option value="Todas">Todas</option>${Object.keys(CONSULTATION_TYPES).filter(k => k).map(type => `<option value="${type}">${type}</option>`).join('')}</select></div><div><label class="form-label">Procedimento</label><select id="report-procedure" class="form-input"><option value="Todos">Todos</option>${procedures.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}</select></div><div><label class="form-label">Status</label><select id="report-status" class="form-input"><option value="Todos">Todos</option><option>Agendada</option><option>Confirmada</option><option>Faltou</option><option>Aberta</option><option>Fechada</option></select></div></div><div class="flex gap-4 mb-6"><button id="generate-report-btn" class="btn btn-primary">Gerar Relatório</button><button id="print-report-btn" class="btn btn-secondary">Imprimir</button><button id="export-excel-btn" class="btn btn-secondary">Exportar Excel</button></div><div id="report-content" class="dashboard-card"><div class="text-center text-gray-500 py-8">Configure os filtros e gere o relatório.</div></div></div>`; 
    document.getElementById('generate-report-btn').onclick = generateReport;
    document.getElementById('print-report-btn').onclick = printReport;
    document.getElementById('export-excel-btn').onclick = exportReportToExcel;
    openModal('modal-relatorios'); 
}
function generateReport() { const startDate = document.getElementById('report-start-date').value, endDate = document.getElementById('report-end-date').value, professional = document.getElementById('report-professional').value, consultationType = document.getElementById('report-consultation-type').value, procedure = document.getElementById('report-procedure').value, status = document.getElementById('report-status').value; if (!startDate || !endDate) { showNotification('error', 'Selecione as datas.'); return; } const start = new Date(startDate + 'T00:00:00'), end = new Date(endDate + 'T23:59:59'); let filteredAppointments = Object.values(appointments).filter(apt => { const aptDate = new Date(apt.date + 'T00:00:00'); return aptDate >= start && aptDate <= end && (professional === 'Todos' || apt.professionalName === professional) && (consultationType === 'Todas' || apt.consultationType === consultationType) && (procedure === 'Todos' || (apt.procedures && apt.procedures.includes(procedure))) && (status === 'Todos' || apt.status === status); }); currentReportData = filteredAppointments; const reportContent = document.getElementById('report-content'); reportContent.innerHTML = `<div class="space-y-4"><h3 class="text-lg font-bold">Relatório de Agendamentos</h3><div class="table-responsive invisible-scrollbar"><table class="data-table report-view"><thead><tr><th>Data</th><th>Horário</th><th>Paciente</th><th>Telefone</th><th>Profissional</th><th>Tipo</th><th>Procedimentos</th><th>Medicação</th><th>Status</th></tr></thead><tbody>${filteredAppointments.map(apt => `<tr><td>${formatDateDDMMAA(apt.date)}</td><td>${apt.time}</td><td>${apt.patientName || ''}</td><td>${window.formatPhoneNumber(apt.patientPhone || '')}</td><td>${apt.professionalName || ''}</td><td>${apt.consultationType || ''}</td><td>${(apt.procedures || []).join(', ')}</td><td>${apt.medication || ''}</td><td>${apt.status}</td></tr>`).join('')}</tbody></table></div><div class="text-sm text-gray-600 mt-4"><strong>Total de registros:</strong> ${filteredAppointments.length}</div></div>`; }
function printReport() { if (currentReportData.length === 0) { showNotification('warning', 'Gere o relatório primeiro.'); return; } const startDate = document.getElementById('report-start-date').value, endDate = document.getElementById('report-end-date').value; const printArea = document.getElementById('report-printable-area'); let tableRows = currentReportData.map(apt => `<tr><td>${formatDateDDMMAA(apt.date)}</td><td>${apt.time}</td><td>${apt.patientName || ''}</td><td>${apt.professionalName || ''}</td><td>${apt.consultationType || ''}</td><td>${(apt.procedures || []).join(', ')}</td><td>${apt.status}</td></tr>`).join(''); printArea.innerHTML = `<div class="print-header-info"><h1>Relatório de Agendamentos</h1><p>Período: ${formatDateDDMMAA(startDate)} a ${formatDateDDMMAA(endDate)}</p></div><table class="print-table"><thead><tr><th>Data</th><th>Hora</th><th>Paciente</th><th>Profissional</th><th>Tipo</th><th>Procedimentos</th><th>Status</th></tr></thead><tbody>${tableRows}</tbody></table>`; window.print(); }
function exportReportToExcel() { if (currentReportData.length === 0) { showNotification('warning', 'Gere o relatório primeiro.'); return; } try { const data = currentReportData.map(apt => ({ 'Data': formatDateDDMMAA(apt.date), 'Horário': apt.time, 'Paciente': apt.patientName || '', 'Telefone': window.formatPhoneNumber(apt.patientPhone || ''), 'Profissional': apt.professionalName || '', 'Tipo': apt.consultationType || '', 'Procedimentos': (apt.procedures || []).join(', '), 'Medicação': apt.medication || '', 'Status': apt.status })); const worksheet = XLSX.utils.json_to_sheet(data); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatório'); XLSX.writeFile(workbook, `relatorio_agendamentos_${new Date().toISOString().split('T')[0]}.xlsx`); showNotification('success', 'Relatório exportado!'); } catch (error) { console.error("Erro ao exportar Excel:", error); showNotification('error', 'Erro ao exportar.'); } }

// --- BACKUP & RESTORE ---
window.backupData = async () => { if(!confirm('Fazer backup de todos os dados?')){return;} showNotification('info','Iniciando backup...',0); const colls=['professionals','medications','procedures','patients','appointments','observations'], backup={}; try{ for(const c of colls){ const s = await getDocs(collection(db, c)); backup[c]=s.docs.map(d=>({id:d.id,...d.data()})); } const j=JSON.stringify(backup,null,2), b=new Blob([j],{type:'application/json'}), u=URL.createObjectURL(b), a=document.createElement('a'); a.href=u;a.download=`backup_tricomaster_${new Date().toISOString().split('T')[0]}.json`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u); showNotification('success','Backup concluído!'); }catch(e){console.error(e);showNotification('error','Falha no backup.');} }
window.restoreData = (e) => { 
    const f=e.target.files[0]; if(!f){return;} const r=new FileReader(); 
    r.onload=function(ev){ try{ const d=JSON.parse(ev.target.result),m=document.getElementById('modal-restore-confirm'); m.innerHTML=`<div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg fade-in"><h2 class="text-xl font-bold text-red-600">Atenção!</h2><p class="my-4">Você vai substituir TODOS os dados atuais pelos do backup. Esta ação não pode ser desfeita. Continuar?</p><div class="flex justify-end gap-4 mt-6"><button onclick="closeModal('modal-restore-confirm')" class="btn btn-secondary">Cancelar</button><button id="confirm-restore-btn" class="btn bg-red-600 hover:bg-red-700 text-white">Sim, Restaurar</button></div></div>`; openModal('modal-restore-confirm'); document.getElementById('confirm-restore-btn').onclick=async()=>{ closeModal('modal-restore-confirm'); showNotification('info','Restaurando, aguarde...',0); await performRestore(d); }; }catch(er){showNotification('error','Arquivo inválido.');console.error(er);} finally{e.target.value='';} }; 
    r.readAsText(f); 
}
async function performRestore(data) { const colls=Object.keys(data); try{ for(const c of colls){ const s = await getDocs(collection(db, c)); const dB = writeBatch(db); s.docs.forEach(d=>{dB.delete(d.ref);}); await dB.commit(); const aB = writeBatch(db); data[c].forEach(i=>{const{id,...iD}=i; aB.set(doc(db, c, id),iD);}); await aB.commit(); } showNotification('success','Restaurado! A página será recarregada.'); setTimeout(()=>window.location.reload(),2000); }catch(e){console.error(e);showNotification('error','Falha na restauração.');} }
