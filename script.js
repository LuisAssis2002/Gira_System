// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot, doc, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, query, orderBy, getDocs, limit, increment, where, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCaKNsfEK9nbyxSS2nCyj2T61DJ34qEjQo",
    authDomain: "sistema-de-tarefas-giramundo.firebaseapp.com",
    projectId: "sistema-de-tarefas-giramundo",
    storageBucket: "sistema-de-tarefas-giramundo.appspot.com",
    messagingSenderId: "429762801810",
    appId: "1:429762801810:web:f889305d35d1d4bfbcf64b"
};

// --- AÇÃO NECESSÁRIA: Ativar Login com Google ---
// 1. Vá para o seu projeto no console do Firebase (https://console.firebase.google.com/).
// 2. No menu à esquerda, vá para "Build" > "Authentication".
// 3. Clique na aba "Sign-in method".
// 4. Na lista de provedores, clique em "Google" e ative-o.

// --- AÇÃO NECESSÁRIA: Autorizar Domínio ---
// 1. No painel do Firebase, vá para "Authentication" > "Settings" > "Authorized domains".
// 2. Clique em "Add domain" e adicione o domínio onde o app está rodando.

// --- AÇÃO NECESSÁRIA: Regras de Segurança do Firestore ---
/*
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        function isAuth() {
          return request.auth != null;
        }
        function isAdmin() {
          return get(/databases/$(database)/documents/republicas/giramundo/moradores/$(request.auth.uid)).data.role == 'admin';
        }

        match /republicas/{republicaId}/{document=**} {
            allow read: if isAuth();
        }
        
        match /republicas/{republicaId}/moradores/{userId} {
            allow create, delete: if isAdmin();
            allow update: if isAdmin() || request.auth.uid == userId;
        }

        match /republicas/{republicaId}/moradores/{userId}/tarefas/{taskId} {
            allow write: if isAuth();
        }
        
        match /republicas/{republicaId}/atas/{ataId} {
            allow create: if isAuth();
            allow delete: if isAdmin();
        }

        match /republicas/{republicaId}/tarefasConcluidas/{taskId} {
            allow write: if isAuth();
            allow delete: if isAdmin();
        }
      }
    }
*/

// --- INITIALIZATION ---
let app, db, auth;
let residents = [];
let completedTasks = [];
let atas = [];
let currentAta = {};
let previousAta = null;
let reviewTopicIndex = 0;
let taskUnsubscribes = {};
let currentUser = null;
const republicaId = "giramundo";

try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    console.log("Firebase initialized successfully!");
    setupAuthenticationListener();
    
} catch (error) {
    console.error("Firebase initialization failed:", error);
    document.getElementById('loading-overlay').innerHTML = `<div class="text-center text-red-600 font-semibold p-4"><p>Falha na inicialização do Firebase.</p></div>`;
}

const complexityConfig = {
    'Fácil': { icon: 'fa-file-alt', color: 'text-green-500', points: 1 },
    'Média': { icon: 'fa-book-open', color: 'text-yellow-500', points: 3 },
    'Difícil': { icon: 'fa-book', color: 'text-red-500', points: 5 }
};

const placeholderColors = [
    '3498db', '2ecc71', 'e74c3c', '9b59b6', 'f1c40f', '1abc9c', 'e67e22', '34495e'
];

function getColorForName(name) {
    if (!name) return placeholderColors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % placeholderColors.length);
    return placeholderColors[index];
}

// --- AUTHENTICATION ---
function setupAuthenticationListener() {
    onAuthStateChanged(auth, async (user) => {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (user) {
            // 1. Criar uma consulta para procurar o e-mail do utilizador
            const moradoresRef = collection(db, "republicas", republicaId, "moradores");
            const q = query(moradoresRef, where("email", "==", user.email));
            
            // 2. Executar a consulta
            const querySnapshot = await getDocs(q);

            // 3. Verificar se encontrou algum resultado
            if (!querySnapshot.empty) {
                // Encontrado! Pegar o primeiro resultado
                const userDocSnap = querySnapshot.docs[0];
                currentUser = { id: userDocSnap.id, ...userDocSnap.data() };
                
                // Atualizar a interface com os dados do utilizador
                document.getElementById('user-name').textContent = user.displayName.split(' ')[0];
                document.getElementById('user-photo').src = user.photoURL;
                document.getElementById('user-info').classList.remove('hidden');

                // Mostrar a aplicação e carregar os dados
                showApp();
                if (Object.keys(taskUnsubscribes).length === 0) {
                    setupListeners();
                }
                updateUIVisibility();
            } else {
                // Não encontrou nenhum morador com este e-mail
                showAccessDenied();
            }
        } else {
            // Utilizador não está logado
            showLogin();
        }
        loadingOverlay.classList.add('hidden');
    });
}

// Função para detetar dispositivos Apple (iPhone, iPad, etc.)
function isAppleDevice() {
    // Método 1: Verificação padrão e mais compatível para iPhones e iPads mais antigos.
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        return true;
    }

    // Método 2: O método moderno (User-Agent Client Hints), se o navegador o suportar.
    // Deteta iPads mais recentes que se podem identificar como "macOS".
    if (navigator.userAgentData && navigator.userAgentData.platform) {
        return navigator.userAgentData.platform === "macOS" && navigator.maxTouchPoints > 1;
    }
    
    // Método 3 (Plano B): O método em descontinuação como última tentativa para
    // navegadores mais antigos que não suportam o método 2.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

window.signInWithGoogle = async function() {
    const provider = new GoogleAuthProvider();

    if (isAppleDevice()) {
        // Para iPhone, iPad, e Safari, usar redirecionamento (mais compatível)
        console.log("Dispositivo Apple detetado, a usar signInWithRedirect.");
        try {
            await signInWithRedirect(auth, provider);
            await getRedirectResult(auth).catch((error) => {
                console.error("Redirect Result Error:", error);
                // Even on error, the onAuthStateChanged will likely have a null user,
                // which will correctly show the login screen.
            });
        } catch (error) {
            console.error("Erro ao iniciar o redirecionamento de login:", error);
            showToast("Não foi possível iniciar o login.", true);
        }
    } else {
        // Para Chrome, Edge, etc., usar pop-up (melhor experiência no desktop)
        console.log("Dispositivo não-Apple detetado, a usar signInWithPopup.");
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Erro no login com Google:", error);
            if (error.code === 'auth/popup-closed-by-user') {
                showToast("Login cancelado pelo utilizador.");
            } else {
                showToast("Ocorreu um erro durante o login.", true);
            }
        }
    }
}

window.signOutUser = async function() {
    try {
        await signOut(auth);
        currentUser = null;
        residents = [];
        atas = [];
        completedTasks = [];
        Object.values(taskUnsubscribes).forEach(unsub => unsub());
        taskUnsubscribes = {};
    } catch (error) {
        console.error("Erro ao sair:", error);
    }
}

function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('access-denied-screen').classList.add('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('access-denied-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
}

function showAccessDenied() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('access-denied-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function updateUIVisibility() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    document.getElementById('admin-buttons').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('fab-add-resident').style.display = isAdmin ? 'flex' : 'none';
}

window.setMyUserAsAdmin = async function() {
    if (!auth.currentUser) {
        showToast("Você precisa estar logado para executar esta função.", true);
        return;
    }
    const userUid = auth.currentUser.uid;
    const userEmail = auth.currentUser.email;
    const userName = auth.currentUser.displayName;
    const userPhoto = auth.currentUser.photoURL;

    const userDocRef = doc(db, "republicas", republicaId, "moradores", userUid);
    
    try {
        const adminQuery = query(collection(db, "republicas", republicaId, "moradores"), where("role", "==", "admin"), limit(1));
        const adminSnapshot = await getDocs(adminQuery);

        if (!adminSnapshot.empty) {
            showToast("Já existe um administrador no sistema.", true);
            return;
        }

        await setDoc(userDocRef, {
            name: userName,
            email: userEmail,
            photo: userPhoto,
            role: 'admin',
            vaciloPoints: 0,
            authUid: userUid 
        });
        showToast(`Sucesso! ${userName} agora é o primeiro administrador. Recarregue a página.`);
        setTimeout(() => location.reload(), 2000);
    } catch (error) {
        console.error("Erro ao se tornar admin:", error);
        showToast("Ocorreu um erro. Verifique o console e suas regras de segurança.", true);
    }
}

// --- DATA LISTENERS (REAL-TIME) ---
function setupListeners() {
    const completedTasksCol = query(collection(db, "republicas", republicaId, "tarefasConcluidas"), orderBy("completedAt", "desc"));
    onSnapshot(completedTasksCol, (snapshot) => {
        completedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderHallOfFame();
    });

    const atasCol = query(collection(db, "republicas", republicaId, "atas"), orderBy("date", "desc"));
    onSnapshot(atasCol, (snapshot) => {
        atas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAtaHistory();
    });

    const residentsCol = collection(db, "republicas", republicaId, "moradores");
    onSnapshot(residentsCol, (residentSnapshot) => {
        Object.values(taskUnsubscribes).forEach(unsub => unsub());
        taskUnsubscribes = {};

        const newResidents = [];
        residentSnapshot.docs.forEach(residentDoc => {
            const residentData = { id: residentDoc.id, ...residentDoc.data(), tasks: [] };
            newResidents.push(residentData);

            const tasksCol = collection(db, "republicas", republicaId, "moradores", residentDoc.id, "tarefas");
            const unsubscribe = onSnapshot(tasksCol, (taskSnapshot) => {
                const residentIndex = residents.findIndex(r => r.id === residentDoc.id);
                if (residentIndex > -1) {
                    residents[residentIndex].tasks = taskSnapshot.docs.map(taskDoc => ({ id: taskDoc.id, ...taskDoc.data() }));
                    renderAll();
                }
            });
            taskUnsubscribes[residentDoc.id] = unsubscribe;
        });
        
        residents = newResidents;
        renderAll();
        
    }, (error) => {
        console.error("Erro ao carregar moradores: ", error);
        showToast("Não foi possível carregar os dados. Verifique suas regras de segurança.", true);
    });
}

// --- RENDERING ---
window.renderAll = function renderAll() {
    renderResidents();
    updateResidentDropdowns();
    renderVaciloManagement();
    renderAdminResidentList();
}

function renderResidents() {
    const grid = document.getElementById('resident-grid');
    grid.innerHTML = '';
    if (residents.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center p-10 bg-white rounded-lg shadow-md">
            <h2 class="text-2xl font-semibold text-gray-600">Nenhum morador cadastrado.</h2>
            <p class="text-gray-500 mt-2">Peça a um admin para adicionar moradores.</p>
        </div>`;
        return;
    }
    residents.sort((a, b) => a.name.localeCompare(b.name)).forEach(resident => {
        const workloadScore = resident.tasks.reduce((acc, task) => acc + (complexityConfig[task.complexity]?.points || 0), 0);
        const bgColor = getWorkloadColor(workloadScore);
        
        const initial = resident.name ? resident.name.charAt(0).toUpperCase() : '?';
        const colorForName = getColorForName(resident.name);
        const dynamicDefaultPhoto = `https://placehold.co/150x150/${colorForName}/FFFFFF?text=${initial}`;
        const photoSrc = resident.photo || dynamicDefaultPhoto;

        const card = document.createElement('div');
        card.className = `resident-card bg-white rounded-lg shadow-lg p-5 flex flex-col items-center gap-4 ${bgColor}`;
        card.innerHTML = `
            <div class="relative w-full flex justify-center">
                <img src="${photoSrc}" alt="Foto de ${resident.name}" class="w-28 h-28 rounded-full object-cover border-4 border-white shadow-md" onerror="this.onerror=null;this.src='${dynamicDefaultPhoto}';">
                <span class="absolute top-0 right-0 bg-red-600 text-white text-sm font-bold w-8 h-8 rounded-full flex items-center justify-center border-2 border-white">${resident.tasks.length}</span>
                 <span class="absolute bottom-0 left-0 bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded-full border-2 border-white" title="Pontos no Vacilômetro">${resident.vaciloPoints || 0} <i class="fas fa-wine-glass-alt"></i></span>
            </div>
            <h3 class="text-xl font-bold text-gray-800">${resident.name}</h3>
            <div class="w-full border-t border-gray-200 pt-4 mt-2 min-h-[100px]">
                <div class="flex flex-wrap justify-center gap-x-4 gap-y-6 no-scrollbar">
                    ${renderTasksForResident(resident)}
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderTasksForResident(resident) {
    if (resident.tasks.length === 0) return '<p class="text-gray-500 text-sm italic">Nenhuma tarefa no momento.</p>';
    return resident.tasks.sort((a,b) => a.name.localeCompare(b.name)).map(task => {
        const config = complexityConfig[task.complexity];
        const deadlineIcon = getDeadlineIcon(task);
        return `
            <div class="flex flex-col items-center text-center cursor-pointer group" onclick="openTaskModal('${task.id}', '${resident.id}')">
                <div class="flex items-center gap-2">
                   <p class="text-xs font-semibold text-gray-600 mb-1 truncate w-20">${task.name}</p>
                   ${deadlineIcon}
                </div>
                <i class="fas ${config ? config.icon : 'fa-question-circle'} ${config ? config.color : 'text-gray-500'} text-3xl group-hover:scale-110 transition-transform"></i>
                <button onclick="event.stopPropagation(); showConfirm('Concluir a tarefa \\'${task.name.replace(/'/g, "\\'")}\\'?', () => window.completeTask('${task.id}', '${resident.id}'))" class="mt-2 text-xs bg-green-500 text-white px-2 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">Concluir</button>
            </div>
        `;
    }).join('');
}

function getDeadlineIcon(task) {
    if (!task.deadline || task.deadline === 'Indeterminado' || !task.createdAt?.toDate) return '';
    const now = new Date();
    const createdAt = task.createdAt.toDate();
    const deadlineDays = task.deadline === '1 semana' ? 7 : 14;
    const deadlineDate = new Date(createdAt.getTime() + deadlineDays * 24 * 60 * 60 * 1000);
    const daysRemaining = (deadlineDate - now) / (1000 * 60 * 60 * 24);
    
    let color = 'text-gray-400';
    if (daysRemaining <= 1) color = 'text-red-500 animate-pulse';
    else if (daysRemaining <= deadlineDays / 2) color = 'text-yellow-500';
    else color = 'text-green-500';

    return `<i class="fas fa-clock ${color}" title="Prazo: ${deadlineDate.toLocaleDateString()}"></i>`;
}

function getWorkloadColor(score) {
    if (score === 0) return 'bg-green-50'; if (score <= 2) return 'bg-green-100'; if (score <= 4) return 'bg-yellow-100';
    if (score <= 6) return 'bg-yellow-200'; if (score <= 8) return 'bg-orange-200'; if (score <= 10) return 'bg-red-200';
    return 'bg-red-300';
}

function updateResidentDropdowns() {
    const selects = [document.getElementById('task-resident'), document.getElementById('ata-scribe')];
    selects.forEach(select => {
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="" disabled>Selecione um morador</option>';
        residents.sort((a,b) => a.name.localeCompare(b.name)).forEach(res => {
            const option = document.createElement('option');
            option.value = res.id;
            option.textContent = res.name;
            select.appendChild(option);
        });
        select.value = currentVal;
    });
}

function renderHallOfFame() {
    const rankingDiv = document.getElementById('fame-ranking');
    const historyDiv = document.getElementById('fame-history');
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthlyScores = {};
    
    completedTasks.forEach(task => {
        if (!task.completedAt?.toDate) return;
        const completedDate = task.completedAt.toDate();
        if (completedDate.getMonth() === currentMonth && completedDate.getFullYear() === currentYear) {
            if (!monthlyScores[task.completedBy.name]) {
                monthlyScores[task.completedBy.name] = 0;
            }
            monthlyScores[task.completedBy.name] += complexityConfig[task.complexity]?.points || 0;
        }
    });
    
    const sortedRanking = Object.entries(monthlyScores).sort((a, b) => b[1] - a[1]);
    const medals = ['🥇', '🥈', '🥉'];
    rankingDiv.innerHTML = sortedRanking.length > 0 ? sortedRanking.map(([name, score], index) => `
        <div class="flex items-center justify-between p-2 rounded-lg ${index < 3 ? 'bg-amber-100' : ''}">
            <span class="font-semibold">${medals[index] || '🏅'} ${name}</span>
            <span class="font-bold text-amber-600">${score} pts</span>
        </div>
    `).join('') : '<p class="text-gray-500 italic">Nenhuma tarefa concluída este mês ainda.</p>';
    
    historyDiv.innerHTML = completedTasks.length > 0 ? completedTasks.map(task => `
        <div class="p-2 border-b">
            <p><strong>${task.completedBy.name}</strong> concluiu a tarefa <strong>"${task.name}"</strong>.</p>
            <p class="text-xs text-gray-500">${task.completedAt?.toDate().toLocaleString('pt-BR') || 'Data indisponível'}</p>
        </div>
    `).join('') : '<p class="text-gray-500 italic">O histórico está vazio.</p>';
}

function renderAtaHistory() {
    const container = document.getElementById('ata-history');
    if (!container) return;
    container.innerHTML = atas.length > 0 ? atas.map(ata => `
        <div class="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
            <div class="cursor-pointer flex-grow" onclick="viewAta('${ata.id}')">
                <p class="font-semibold text-blue-700">ATA de ${new Date(ata.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}</p>
                <p class="text-xs text-gray-500">Escrivão(ã): ${ata.scribeName || 'Não informado'}</p>
            </div>
            <button onclick="handleExportAta('${ata.id}')" class="text-gray-500 hover:text-gray-700 ml-4 p-2" title="Exportar ATA"><i class="fas fa-download"></i></button>
            <button onclick="handleDeleteAta('${ata.id}')" class="text-red-500 hover:text-red-700 ml-2 p-2" title="Deletar ATA"><i class="fas fa-trash-alt"></i></button>
        </div>
    `).join('') : '<p class="text-gray-500 italic">Nenhuma ATA encontrada.</p>';
}

function renderVaciloManagement() {
    const container = document.getElementById('vacilo-management-list');
    if (!container) return;
    container.innerHTML = residents.sort((a, b) => a.name.localeCompare(b.name)).map(res => `
        <div class="flex items-center justify-between p-2 border-b">
            <div>
                <span class="font-semibold">${res.name}</span>
                <span class="text-sm text-gray-600">- ${res.vaciloPoints || 0} pts</span>
            </div>
            <button onclick="openVaciloAdjustModal('${res.id}', '${res.name}')" class="bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold py-1 px-2 rounded">Ajustar</button>
        </div>
    `).join('');
}

function renderAdminResidentList() {
    const container = document.getElementById('admin-resident-list');
    if (!container) return;
    container.innerHTML = residents.sort((a, b) => a.name.localeCompare(b.name)).map(res => `
        <div class="flex items-center justify-between p-3 border rounded-lg bg-white">
            <div>
                <p class="font-semibold">${res.name}</p>
                <p class="text-xs text-gray-500">${res.email || 'Email não vinculado'}</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold px-2 py-1 rounded-full ${res.role === 'admin' ? 'bg-purple-200 text-purple-800' : 'bg-gray-200 text-gray-800'}">${res.role || 'morador'}</span>
                <button onclick="toggleAdminRole('${res.id}', '${res.role}')" class="bg-gray-200 hover:bg-gray-300 text-xs font-bold py-1 px-2 rounded">${res.role === 'admin' ? 'Rebaixar' : 'Promover'}</button>
                <button onclick="openResidentModal('${res.id}', true)" class="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-2 rounded">Editar</button>
            </div>
        </div>
    `).join('');
}

// --- MODAL HANDLING ---
window.openModal = function openModal(modalId) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(`${modalId}-content`);
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 10);
}
window.closeModal = function closeModal(modalId) {
    if (modalId === 'ata-editor-modal') {
        document.querySelector('#app-container header').style.display = 'flex';
    }

    const modal = document.getElementById(modalId);
    const content = document.getElementById(`${modalId}-content`);
    modal.classList.add('opacity-0');
    if (content) {
        content.classList.add('scale-95', 'opacity-0');
        content.classList.remove('scale-100', 'opacity-100');
    }
    setTimeout(() => modal.classList.add('hidden'), 300);
}
window.openTaskModal = function openTaskModal(taskId = null, residentId = null) {
    const form = document.getElementById('task-form');
    form.reset();
    document.getElementById('task-id').value = '';
    document.getElementById('task-resident-id-hidden').value = '';
    document.querySelectorAll('.complexity-btn').forEach(btn => btn.classList.remove('bg-gray-200'));

    if (taskId && residentId) {
        const resident = residents.find(r => r.id === residentId);
        const task = resident.tasks.find(t => t.id === taskId);
        document.getElementById('task-modal-title').textContent = 'Editar Tarefa';
        document.getElementById('task-id').value = task.id;
        document.getElementById('task-resident-id-hidden').value = residentId;
        document.getElementById('task-name').value = task.name;
        document.getElementById('task-complexity').value = task.complexity;
        document.querySelector(`.complexity-btn[data-complexity="${task.complexity}"]`).classList.add('bg-gray-200');
        document.getElementById('task-deadline').value = task.deadline;
        document.getElementById('task-resident').value = residentId;
        document.getElementById('task-description').value = task.description;
    } else {
        document.getElementById('task-modal-title').textContent = 'Nova Tarefa';
    }
    openModal('task-modal');
}
window.openResidentModal = function openResidentModal(residentId = null, isAdminAction = false) {
    const form = document.getElementById('resident-form');
    form.reset();
    document.getElementById('resident-id').value = '';
    document.getElementById('resident-photo-base64').value = '';
    const editOptions = document.getElementById('resident-edit-options');

    if (residentId) {
        const resident = residents.find(r => r.id === residentId);
        document.getElementById('resident-modal-title').textContent = 'Editar Morador';
        document.getElementById('resident-id').value = resident.id;
        document.getElementById('resident-name').value = resident.name;
        document.getElementById('resident-email').value = resident.email || '';
        document.getElementById('resident-photo-base64').value = resident.photo;
        editOptions.style.display = isAdminAction ? 'block' : 'none';
    } else {
        document.getElementById('resident-modal-title').textContent = 'Novo Morador';
        editOptions.style.display = 'none';
    }
    openModal('resident-modal');
}
window.openHallOfFameModal = function openHallOfFameModal() {
    renderVaciloManagement();
    openModal('hall-of-fame-modal');
}
window.openAtaListModal = function openAtaListModal() {
    openModal('ata-list-modal');
}
window.openAdminModal = function openAdminModal() {
    renderAdminResidentList();
    openModal('admin-modal');
}

// --- EVENT LISTENERS & HANDLERS ---
document.addEventListener('DOMContentLoaded', () => {
     document.getElementById('task-form').addEventListener('submit', handleSaveTask);
     document.getElementById('resident-form').addEventListener('submit', handleSaveResident);
     document.querySelectorAll('.complexity-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.complexity-btn').forEach(b => b.classList.remove('bg-gray-200'));
            btn.classList.add('bg-gray-200');
            document.getElementById('task-complexity').value = btn.dataset.complexity;
        });
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ['task-modal', 'resident-modal', 'confirm-modal', 'hall-of-fame-modal', 'ata-list-modal', 'ata-editor-modal', 'ata-review-modal', 'ata-topic-modal', 'ata-view-modal', 'vacilo-adjust-modal', 'admin-modal'].forEach(closeModal);
        }
    });
    document.getElementById('ata-topic-form').addEventListener('submit', handleSaveAtaTopic);
    document.getElementById('vacilo-adjust-form').addEventListener('submit', handleAdjustVaciloPoints);
});

async function handleSaveTask(e) {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
    
    try {
        const taskId = document.getElementById('task-id').value;
        const oldResidentId = document.getElementById('task-resident-id-hidden').value;
        const newResidentId = document.getElementById('task-resident').value;
        
        const taskData = {
            name: document.getElementById('task-name').value,
            complexity: document.getElementById('task-complexity').value,
            deadline: document.getElementById('task-deadline').value,
            description: document.getElementById('task-description').value,
        };

        if (!taskData.complexity || !newResidentId) {
            showToast('Por favor, selecione a complexidade e atribua a um morador.', true); return;
        }

        if (taskId && oldResidentId === newResidentId) { // Editing task, same resident
            const taskRef = doc(db, "republicas", republicaId, "moradores", newResidentId, "tarefas", taskId);
            await updateDoc(taskRef, taskData);
        } else { // New task or transferred task
            if (taskId) { // Transferred: delete from old
                const oldTaskRef = doc(db, "republicas", republicaId, "moradores", oldResidentId, "tarefas", taskId);
                await deleteDoc(oldTaskRef);
            }
            // Add to new
            taskData.createdAt = serverTimestamp();
            const newTaskCol = collection(db, "republicas", republicaId, "moradores", newResidentId, "tarefas");
            await addDoc(newTaskCol, taskData);
        }
    } catch (error) {
        console.error("Erro ao salvar tarefa:", error);
        showToast("Ocorreu um erro ao salvar a tarefa.", true);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Salvar';
        closeModal('task-modal');
    }
}

function resizeImage(file, maxWidth, maxHeight, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            callback(canvas.toDataURL('image/jpeg', 0.8)); // Compress to JPEG
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function handleSaveResident(e) {
    e.preventDefault();
    const submitButton = e.target.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

    const residentId = document.getElementById('resident-id').value;
    const name = document.getElementById('resident-name').value;
    const email = document.getElementById('resident-email').value;
    const photoFile = document.getElementById('resident-photo-file').files[0];
    
    const saveToFirestore = async (photoData) => {
        try {
            const residentData = { name, email };
            if (photoData) {
                residentData.photo = photoData;
            }
            
            if (residentId) { // Editing
                const residentRef = doc(db, "republicas", republicaId, "moradores", residentId);
                await updateDoc(residentRef, residentData);
            } else { // Creating
                residentData.vaciloPoints = 0;
                residentData.photo = photoData || '';
                residentData.role = 'morador'; // Default role
                const residentsCol = collection(db, "republicas", republicaId, "moradores");
                await addDoc(residentsCol, residentData);
            }
        } catch (error) {
            console.error("Erro ao salvar morador:", error);
            showToast("Ocorreu um erro ao salvar o morador.", true);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Salvar';
            closeModal('resident-modal');
        }
    };

    if (photoFile) {
        resizeImage(photoFile, 300, 300, (base64) => {
            saveToFirestore(base64);
        });
    } else {
        const existingPhoto = document.getElementById('resident-photo-base64').value;
        saveToFirestore(residentId ? existingPhoto : ''); 
    }
}

window.completeTask = async function(taskId, residentId) {
    const resident = residents.find(r => r.id === residentId);
    if (!resident) return;
    const task = resident.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const taskRef = doc(db, "republicas", republicaId, "moradores", residentId, "tarefas", taskId);
    const completedTaskCol = collection(db, "republicas", republicaId, "tarefasConcluidas");
    
    const batch = writeBatch(db);
    batch.set(doc(completedTaskCol), {
        ...task,
        completedAt: serverTimestamp(),
        completedBy: { id: resident.id, name: resident.name }
    });
    batch.delete(taskRef);
    await batch.commit();
}

window.handleDeleteResident = async function handleDeleteResident() {
    const residentId = document.getElementById('resident-id').value;
    const resident = residents.find(r => r.id === residentId);
    showConfirm(`Tem certeza que deseja remover ${resident.name}? Todas as suas tarefas serão perdidas.`, async () => {
        const residentRef = doc(db, "republicas", republicaId, "moradores", residentId);
        await deleteDoc(residentRef);
        closeModal('resident-modal');
        showToast(`${resident.name} foi removido.`);
    });
}

window.showConfirm = function showConfirm(message, onConfirm) {
    const confirmModal = document.getElementById('confirm-modal');
    document.getElementById('confirm-message').textContent = message;
    openModal('confirm-modal');

    const okButton = document.getElementById('confirm-ok');
    const cancelButton = document.getElementById('confirm-cancel');

    const okListener = () => { onConfirm(); closeModal('confirm-modal'); cleanup(); };
    const cancelListener = () => { closeModal('confirm-modal'); cleanup(); };
    const cleanup = () => {
        okButton.removeEventListener('click', okListener);
        cancelButton.removeEventListener('click', cancelListener);
    };
    okButton.addEventListener('click', okListener, { once: true });
    cancelButton.addEventListener('click', cancelListener, { once: true });
}

// --- ATA LOGIC ---
window.openAtaEditor = async function openAtaEditor(ataId = null) {
    // TODO: Implement editing existing ATAs
    currentAta = { date: new Date().toISOString().split('T')[0], scribeId: '', topics: [] };
    document.getElementById('ata-date').value = currentAta.date;
    document.getElementById('ata-scribe').value = '';
    
    const atasQuery = query(collection(db, "republicas", republicaId, "atas"), orderBy("date", "desc"), limit(1));
    const querySnapshot = await getDocs(atasQuery);
    if (!querySnapshot.empty) {
        previousAta = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
        if (!Array.isArray(previousAta.topics)) {
            previousAta.topics = [];
        }
    } else {
        previousAta = null;
    }
    
    document.getElementById('review-ata-btn').style.display = previousAta ? 'inline-block' : 'none';

    renderAtaEditor();
    
    document.querySelector('#app-container header').style.display = 'none'; 
    closeModal('ata-list-modal');
    openModal('ata-editor-modal');
}

function renderAtaEditor() {
    const container = document.getElementById('ata-sections-container');
    container.innerHTML = '';
    const sections = ['CASA', 'ENCONTRO (XV)', 'VACILÔMETRO'];
    
    sections.forEach(sectionName => {
        const sectionId = sectionName.replace(/[^a-zA-Z0-9]/g, '-');
        const sectionEl = document.createElement('div');
        sectionEl.innerHTML = `
            <h3 class="text-xl font-semibold mb-3 border-b-2 pb-2 border-blue-200">${sectionName}</h3>
            <div id="topics-${sectionId}" class="space-y-3">
                <!-- Topics will be rendered here -->
            </div>
            <button onclick="openAtaTopicModal('${sectionName}')" class="mt-4 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-2 px-4 rounded-lg text-sm">
                <i class="fas fa-plus mr-2"></i>Adicionar Tópico
            </button>
        `;
        container.appendChild(sectionEl);
        renderAtaTopics(sectionName);
    });
}

function renderAtaTopics(sectionName) {
    const sectionId = sectionName.replace(/[^a-zA-Z0-9]/g, '-');
    const container = document.getElementById(`topics-${sectionId}`);
    if (!container) return;
    
    const sectionTopics = currentAta.topics.filter(t => t.section === sectionName);
    container.innerHTML = sectionTopics.length > 0 ? sectionTopics.map(topic => {
        let contentHTML = '';
        const iconMap = { 'discussao': 'fa-comments', 'tarefa': 'fa-tasks', 'decisao': 'fa-gavel', 'vacilo': 'fa-wine-glass-alt' };
        const colorMap = { 'discussao': 'bg-white', 'tarefa': 'bg-blue-50', 'decisao': 'bg-green-50', 'vacilo': 'bg-purple-50' };
        
        switch(topic.type) {
            case 'tarefa':
                contentHTML = `<p><strong>Tarefa:</strong> ${topic.description}</p><p class="text-sm text-gray-600"><strong>Responsável:</strong> ${topic.responsibleName} | <strong>Complexidade:</strong> ${topic.complexity} | <strong>Prazo:</strong> ${topic.deadline}</p>`;
                break;
            case 'vacilo':
                contentHTML = `<p><strong>Vacilo:</strong> ${topic.residentName}</p><p class="text-sm text-gray-600"><strong>Pontos:</strong> ${topic.points} | <strong>Motivo:</strong> ${topic.reason}</p>`;
                break;
            default:
                contentHTML = `<p>${topic.content}</p>`;
        }

        return `<div class="p-3 rounded-lg shadow-sm ${colorMap[topic.type]} flex items-start">
            <i class="fas ${iconMap[topic.type]} mr-3 mt-1 text-gray-500"></i>
            <div>${contentHTML}</div>
        </div>`;
    }).join('') : '<p class="text-sm italic text-gray-500">Nenhum tópico adicionado.</p>';
}

window.openAtaTopicModal = function openAtaTopicModal(sectionName, topicIndex = null) {
    const form = document.getElementById('ata-topic-form');
    form.reset();
    document.getElementById('ata-topic-section').value = sectionName;
    document.getElementById('ata-topic-type').value = '';
    document.getElementById('ata-topic-index').value = topicIndex === null ? '' : topicIndex;
    document.getElementById('topic-fields-container').innerHTML = '';
    document.querySelectorAll('.topic-type-btn').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
        btn.onclick = () => selectTopicType(btn.dataset.type);
        btn.disabled = false;
    });

    if (topicIndex !== null) {
        const topic = currentAta.topics[topicIndex];
        document.getElementById('ata-topic-modal-title').textContent = 'Editar Tópico';
        selectTopicType(topic.type);
        // Disable type switching when editing
        document.querySelectorAll('.topic-type-btn').forEach(btn => btn.disabled = true);
        
        // Pre-fill fields
        setTimeout(() => {
            switch(topic.type) {
                case 'discussao':
                case 'decisao':
                    document.getElementById('topic-content').value = topic.content;
                    break;
                case 'tarefa':
                    document.getElementById('topic-task-desc').value = topic.description;
                    document.getElementById('topic-task-resident').value = topic.responsibleId;
                    document.getElementById('topic-task-complexity').value = topic.complexity;
                    document.getElementById('topic-task-deadline').value = topic.deadline;
                    break;
                case 'vacilo':
                     document.getElementById('topic-vacilo-resident').value = topic.residentId;
                     document.getElementById('topic-vacilo-points').value = topic.points;
                     document.getElementById('topic-vacilo-reason').value = topic.reason;
                    break;
            }
        }, 100);

    } else {
        document.getElementById('ata-topic-modal-title').textContent = 'Novo Tópico';
    }
    openModal('ata-topic-modal');
}

window.selectTopicType = function selectTopicType(type) {
    document.getElementById('ata-topic-type').value = type;
    document.querySelectorAll('.topic-type-btn').forEach(btn => {
        btn.classList.remove('bg-blue-500', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700');
    });
    const selectedBtn = document.querySelector(`.topic-type-btn[data-type="${type}"]`);
    selectedBtn.classList.add('bg-blue-500', 'text-white');
    selectedBtn.classList.remove('bg-gray-200', 'text-gray-700');
    
    renderTopicFields(type);
}

function renderTopicFields(type) {
    const container = document.getElementById('topic-fields-container');
    let fieldsHTML = '';
    const residentOptions = residents.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

    switch(type) {
        case 'discussao':
        case 'decisao':
            fieldsHTML = `<div><label class="block text-sm font-medium">Descrição</label><textarea id="topic-content" class="w-full p-2 border rounded" rows="3" required></textarea></div>`;
            break;
        case 'tarefa':
            fieldsHTML = `
                <div><label class="block text-sm font-medium">Descrição da Tarefa</label><input type="text" id="topic-task-desc" class="w-full p-2 border rounded" required></div>
                <div><label class="block text-sm font-medium">Responsável</label><select id="topic-task-resident" class="w-full p-2 border rounded" required>${residentOptions}</select></div>
                <div><label class="block text-sm font-medium">Complexidade</label><select id="topic-task-complexity" class="w-full p-2 border rounded"><option>Fácil</option><option>Média</option><option>Difícil</option></select></div>
                <div><label class="block text-sm font-medium">Prazo</label><select id="topic-task-deadline" class="w-full p-2 border rounded"><option>Indeterminado</option><option>1 semana</option><option>2 semanas</option></select></div>
            `;
            break;
        case 'vacilo':
            fieldsHTML = `
                <div><label class="block text-sm font-medium">Morador</label><select id="topic-vacilo-resident" class="w-full p-2 border rounded" required>${residentOptions}</select></div>
                <div><label class="block text-sm font-medium">Pontos</label><input type="number" id="topic-vacilo-points" class="w-full p-2 border rounded" step="0.5" required></div>
                <div><label class="block text-sm font-medium">Motivo</label><input type="text" id="topic-vacilo-reason" class="w-full p-2 border rounded" required></div>
            `;
            break;
    }
    container.innerHTML = fieldsHTML;
}

window.handleSaveAtaTopic = function handleSaveAtaTopic(e) {
    e.preventDefault();
    const section = document.getElementById('ata-topic-section').value;
    const type = document.getElementById('ata-topic-type').value;
    const index = document.getElementById('ata-topic-index').value;

    if (!type) {
        showToast("Por favor, selecione um tipo de tópico.", true);
        return;
    }

    let topicData = { section, type };
    try {
        switch(type) {
            case 'discussao':
            case 'decisao':
                topicData.content = document.getElementById('topic-content').value;
                break;
            case 'tarefa':
                const residentSelect = document.getElementById('topic-task-resident');
                topicData.description = document.getElementById('topic-task-desc').value;
                topicData.responsibleId = residentSelect.value;
                topicData.responsibleName = residentSelect.options[residentSelect.selectedIndex].text;
                topicData.complexity = document.getElementById('topic-task-complexity').value;
                topicData.deadline = document.getElementById('topic-task-deadline').value;
                if(index !== '') { // Preserve original task ID if editing
                   topicData.generatedTaskId = currentAta.topics[index].generatedTaskId;
                }
                break;
            case 'vacilo':
                const vaciloSelect = document.getElementById('topic-vacilo-resident');
                topicData.residentId = vaciloSelect.value;
                topicData.residentName = vaciloSelect.options[vaciloSelect.selectedIndex].text;
                topicData.points = parseFloat(document.getElementById('topic-vacilo-points').value);
                topicData.reason = document.getElementById('topic-vacilo-reason').value;
                break;
        }

        if (index !== '') {
            currentAta.topics[index] = topicData;
        } else {
            currentAta.topics.push(topicData);
        }
        
        renderAtaTopics(section);
        closeModal('ata-topic-modal');
    } catch (error) {
        console.error("Erro ao criar tópico:", error);
        showToast("Não foi possível adicionar o tópico.", true);
    }
}

window.startAtaReview = function startAtaReview() {
    if (!previousAta || !previousAta.topics || previousAta.topics.length === 0) {
        showToast("Nenhuma ATA anterior com tópicos para revisar.");
        return;
    }
    reviewTopicIndex = 0;
    displayCurrentReviewTopic();
    openModal('ata-review-modal');
}

function displayCurrentReviewTopic() {
    const topic = previousAta.topics[reviewTopicIndex];
    document.getElementById('review-topic-counter').textContent = `Revisando Tópico ${reviewTopicIndex + 1} de ${previousAta.topics.length}`;
    
    let contentHTML = '';
     switch(topic.type) {
        case 'tarefa':
            contentHTML = `<p><strong>Tarefa:</strong> ${topic.description}</p><p class="text-sm text-gray-600"><strong>Responsável:</strong> ${topic.responsibleName}</p>`;
            break;
        case 'vacilo':
            contentHTML = `<p><strong>Vacilo:</strong> ${topic.residentName}</p><p class="text-sm text-gray-600"><strong>Pontos:</strong> ${topic.points} | <strong>Motivo:</strong> ${topic.reason}</p>`;
            break;
        default:
            contentHTML = `<p>${topic.content}</p>`;
    }
    document.getElementById('review-topic-card').innerHTML = `
        <p class="font-semibold text-left text-sm text-gray-500 mb-2">${topic.section}</p>
        <div class="text-lg">${contentHTML}</div>
    `;
}

window.handleKeepTopic = function handleKeepTopic() {
    const topic = { ...previousAta.topics[reviewTopicIndex] };
    
    if (topic.type === 'tarefa') {
        // Open editor instead of just pushing
        const newTopicIndex = currentAta.topics.length;
        currentAta.topics.push(topic);
        openAtaTopicModal(topic.section, newTopicIndex);
    } else {
        currentAta.topics.push(topic);
        renderAtaTopics(topic.section);
    }
    advanceReview();
}

window.handleDiscussTopic = function handleDiscussTopic() {
    closeModal('ata-review-modal');
    const reviewBtn = document.getElementById('review-ata-btn');
    reviewBtn.textContent = 'Continuar Revisão';
    reviewBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
    reviewBtn.classList.add('bg-teal-500', 'hover:bg-teal-600');
}

window.handleArchiveTopic = function handleArchiveTopic() {
    advanceReview();
}

function advanceReview() {
    reviewTopicIndex++;
    if (reviewTopicIndex >= previousAta.topics.length) {
        showToast("Revisão da ATA anterior concluída!");
        closeModal('ata-review-modal');
        const reviewBtn = document.getElementById('review-ata-btn');
        reviewBtn.textContent = 'Revisar ATA Anterior';
        reviewBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
        reviewBtn.classList.remove('bg-teal-500', 'hover:bg-teal-600');
    } else {
        displayCurrentReviewTopic();
    }
}

window.saveAta = async function saveAta() {
    currentAta.date = document.getElementById('ata-date').value;
    const scribeSelect = document.getElementById('ata-scribe');
    currentAta.scribeId = scribeSelect.value;
    currentAta.scribeName = scribeSelect.options[scribeSelect.selectedIndex].text;

    if (!currentAta.date || !currentAta.scribeId) {
        showToast("Por favor, preencha a data e o escrivão da ATA.", true);
        return;
    }
    
    try {
        const batch = writeBatch(db);
        const finalTopicsForAta = [...currentAta.topics];

        // Process all topics within the batch
        finalTopicsForAta.forEach((topic, index) => {
            if (topic.type === 'tarefa') {
                const taskData = {
                    name: topic.description,
                    complexity: topic.complexity,
                    deadline: topic.deadline,
                    description: `Criada via ATA de ${new Date(currentAta.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}`,
                };

                if (topic.generatedTaskId) {
                    // This is an EXISTING task, so UPDATE it.
                    const taskRef = doc(db, "republicas", republicaId, "moradores", topic.responsibleId, "tarefas", topic.generatedTaskId);
                    batch.update(taskRef, taskData);
                } else {
                    // This is a NEW task, so CREATE it and get its ID for the ATA.
                    const newTaskRef = doc(collection(db, "republicas", republicaId, "moradores", topic.responsibleId, "tarefas"));
                    taskData.createdAt = serverTimestamp();
                    batch.set(newTaskRef, taskData);
                    finalTopicsForAta[index].generatedTaskId = newTaskRef.id;
                }
            } else if (topic.type === 'vacilo') {
                const residentRef = doc(db, "republicas", republicaId, "moradores", topic.residentId);
                batch.update(residentRef, { vaciloPoints: increment(topic.points) });
            }
        });

        // Now, add the ATA document itself to the batch, using the final topics array
        const ataCol = collection(db, "republicas", republicaId, "atas");
        batch.set(doc(ataCol), {
            date: currentAta.date,
            scribeId: currentAta.scribeId,
            scribeName: currentAta.scribeName,
            topics: finalTopicsForAta, // Use the array that has the new task IDs
            createdAt: serverTimestamp()
        });
        
        await batch.commit();

        showToast("ATA salva com sucesso!");
        closeModal('ata-editor-modal');

    } catch(error) {
        console.error("Erro ao salvar ATA:", error);
        showToast("Não foi possível salvar a ATA.", true);
    }
}

window.viewAta = function viewAta(ataId) {
    const ata = atas.find(a => a.id === ataId);
    if (!ata) return;

    document.getElementById('ata-view-title').textContent = `ATA de ${new Date(ata.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}`;
    const contentContainer = document.getElementById('ata-view-content');
    
    let html = `<p class="mb-6 text-center text-gray-600"><strong>Escrivão(ã):</strong> ${ata.scribeName}</p>`;
    const sections = ['CASA', 'ENCONTRO (XV)', 'VACILÔMETRO'];

    sections.forEach(sectionName => {
        const sectionTopics = ata.topics.filter(t => t.section === sectionName);
        if (sectionTopics.length > 0) {
            html += `<h3 class="text-xl font-semibold mb-3 mt-6 border-b-2 pb-2 border-blue-200">${sectionName}</h3>`;
            html += '<div class="space-y-3">';
            sectionTopics.forEach(topic => {
                let contentHTML = '';
                const iconMap = { 'discussao': 'fa-comments', 'tarefa': 'fa-tasks', 'decisao': 'fa-gavel', 'vacilo': 'fa-wine-glass-alt' };
                const colorMap = { 'discussao': 'bg-white', 'tarefa': 'bg-blue-50', 'decisao': 'bg-green-50', 'vacilo': 'bg-purple-50' };
                
                switch(topic.type) {
                    case 'tarefa':
                        contentHTML = `<p><strong>Tarefa:</strong> ${topic.description}</p><p class="text-sm text-gray-600"><strong>Responsável:</strong> ${topic.responsibleName} | <strong>Complexidade:</strong> ${topic.complexity} | <strong>Prazo:</strong> ${topic.deadline}</p>`;
                        break;
                    case 'vacilo':
                        contentHTML = `<p><strong>Vacilo:</strong> ${topic.residentName}</p><p class="text-sm text-gray-600"><strong>Pontos:</strong> ${topic.points} | <strong>Motivo:</strong> ${topic.reason}</p>`;
                        break;
                    default:
                        contentHTML = `<p>${topic.content}</p>`;
                }
                html += `<div class="p-3 rounded-lg shadow-sm ${colorMap[topic.type]} flex items-start">
                    <i class="fas ${iconMap[topic.type]} mr-3 mt-1 text-gray-500"></i>
                    <div>${contentHTML}</div>
                </div>`;
            });
            html += '</div>';
        }
    });

    contentContainer.innerHTML = html;
    openModal('ata-view-modal');
}

window.openVaciloAdjustModal = function openVaciloAdjustModal(residentId, residentName) {
    document.getElementById('vacilo-adjust-title').textContent = `Ajustar Pontos de ${residentName}`;
    document.getElementById('vacilo-adjust-resident-id').value = residentId;
    document.getElementById('vacilo-adjust-form').reset();
    openModal('vacilo-adjust-modal');
}

async function handleAdjustVaciloPoints(e) {
    e.preventDefault();
    const residentId = document.getElementById('vacilo-adjust-resident-id').value;
    const points = parseFloat(document.getElementById('vacilo-adjust-points').value);
    
    if (!residentId || isNaN(points)) {
        showToast("Por favor, insira um valor válido.", true);
        return;
    }

    try {
        const residentRef = doc(db, "republicas", republicaId, "moradores", residentId);
        await updateDoc(residentRef, { vaciloPoints: increment(points) });
        showToast("Pontos ajustados com sucesso!");
        closeModal('vacilo-adjust-modal');
    } catch (error) {
        console.error("Erro ao ajustar pontos:", error);
        showToast("Não foi possível ajustar os pontos.", true);
    }
}

window.handleResetAllVacilos = function handleResetAllVacilos() {
    showConfirm("Tem certeza que deseja ZERAR os pontos de todos os moradores?", async () => {
        try {
            const batch = writeBatch(db);
            residents.forEach(res => {
                const residentRef = doc(db, "republicas", republicaId, "moradores", res.id);
                batch.update(residentRef, { vaciloPoints: 0 });
            });
            await batch.commit();
            showToast("Pontos de todos os moradores foram zerados!");
        } catch(error) {
            console.error("Erro ao resetar pontos:", error);
            showToast("Não foi possível resetar os pontos.", true);
        }
    });
}

window.handleDeleteAta = function handleDeleteAta(ataId) {
    showConfirm("Tem certeza que deseja deletar esta ATA? Esta ação não pode ser desfeita.", async () => {
        try {
            const ataRef = doc(db, "republicas", republicaId, "atas", ataId);
            await deleteDoc(ataRef);
            showToast("ATA deletada com sucesso.");
        } catch(error) {
            console.error("Erro ao deletar ATA:", error);
            showToast("Não foi possível deletar a ATA.", true);
        }
    });
}

window.handleResetRankAndHistory = function handleResetRankAndHistory() {
    showConfirm("Tem certeza que deseja ZERAR o rank e o histórico de tarefas concluídas? Esta ação não pode ser desfeita.", async () => {
        try {
            const completedTasksCol = collection(db, "republicas", republicaId, "tarefasConcluidas");
            const snapshot = await getDocs(completedTasksCol);
            const batch = writeBatch(db);
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            showToast("Rank e histórico de tarefas foram zerados!");
        } catch(error) {
            console.error("Erro ao resetar rank:", error);
            showToast("Não foi possível resetar o rank e o histórico.", true);
        }
    });
}

window.handleExportAta = function handleExportAta(ataId) {
    const ata = atas.find(a => a.id === ataId);
    if (!ata) {
        showToast("ATA não encontrada.", true);
        return;
    }

    let content = "**************************************************\n";
    content += "* ATA DA REPÚBLICA GIRAMUNDO        *\n";
    content += "**************************************************\n\n";
    content += `Data da Reunião: ${new Date(ata.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})}\n`;
    content += `Escrivão(ã): ${ata.scribeName}\n\n`;

    const sections = ['CASA', 'ENCONTRO (XV)', 'VACILÔMETRO'];
    sections.forEach(sectionName => {
        const sectionTopics = ata.topics.filter(t => t.section === sectionName);
        if (sectionTopics.length > 0) {
            content += `--------------------------------------------------\n`;
            content += `[ SEÇÃO: ${sectionName} ]\n`;
            content += `--------------------------------------------------\n\n`;

            sectionTopics.forEach(topic => {
                switch(topic.type) {
                    case 'tarefa':
                        content += `[TAREFA]\n`;
                        content += `- Descrição: ${topic.description}\n`;
                        content += `- Responsável: ${topic.responsibleName}\n`;
                        content += `- Complexidade: ${topic.complexity}\n`;
                        content += `- Prazo: ${topic.deadline}\n\n`;
                        break;
                    case 'vacilo':
                        content += `[VACILO]\n`;
                        content += `- Morador: ${topic.residentName}\n`;
                        content += `- Pontos: ${topic.points}\n`;
                        content += `- Motivo: ${topic.reason}\n\n`;
                        break;
                    case 'discussao':
                        content += `[DISCUSSÃO]\n- ${topic.content}\n\n`;
                        break;
                    case 'decisao':
                        content += `[DECISÃO]\n- ${topic.content}\n\n`;
                        break;
                }
            });
        }
    });

    content += "**************************************************\n";
    content += "* FIM DA ATA           *\n";
    content += "**************************************************\n";

    const filename = `ATA_${ata.date}.txt`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.toggleAdminRole = async function(residentId, currentRole) {
    const newRole = currentRole === 'admin' ? 'morador' : 'admin';
    const residentRef = doc(db, "republicas", republicaId, "moradores", residentId);
    try {
        await updateDoc(residentRef, { role: newRole });
        showToast("Cargo atualizado com sucesso.");
    } catch (error) {
        console.error("Erro ao alterar cargo:", error);
        showToast("Não foi possível alterar o cargo.", true);
    }
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast-notification');
    const toastMessage = document.getElementById('toast-message');
    
    toastMessage.textContent = message;
    toast.classList.remove('bg-green-500', 'bg-red-500', 'translate-x-full');
    
    if (isError) {
        toast.classList.add('bg-red-500');
    } else {
        toast.classList.add('bg-green-500');
    }

    toast.classList.remove('translate-x-full');
    toast.classList.add('translate-x-0');

    setTimeout(() => {
        toast.classList.remove('translate-x-0');
        toast.classList.add('translate-x-full');
    }, 4000);
}
