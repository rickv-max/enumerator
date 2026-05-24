import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, setDoc, doc } from 'firebase/firestore';
import { 
  Plus, ListTodo, Activity, AlertCircle, CheckCircle2, 
  MapPin, FileSpreadsheet, ChevronRight, ChevronLeft, 
  RefreshCcw, Layers, Zap, Home, Users, HardDrive, Send, CloudLightning, Loader2
} from 'lucide-react';

// ==========================================
// 0. FIREBASE CLOUD STORAGE INIT
// ==========================================
const isCloudAvailable = typeof __firebase_config !== 'undefined';
let app, auth, db, appId;

if (isCloudAvailable) {
  try {
    const firebaseConfig = JSON.parse(__firebase_config);
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'geosensus-app';
  } catch (err) {
    console.warn("Cloud initialization failed, falling back to local mode.");
  }
}

// ==========================================
// 1. FAILSAFE & ERROR BOUNDARY
// ==========================================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error) { console.error("Failsafe triggered:", error); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F7F8] flex items-center justify-center p-6 font-sans text-zinc-900">
          <div className="bg-white p-8 rounded-[24px] shadow-sm border border-zinc-200/60 max-w-sm w-full text-center">
            <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={24} strokeWidth={2} />
            </div>
            <h3 className="font-semibold text-lg mb-2 tracking-tight">System Error</h3>
            <p className="text-[13px] text-zinc-500 mb-8 leading-relaxed font-mono overflow-auto max-h-32">{this.state.error?.toString()}</p>
            <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} className="w-full bg-zinc-900 hover:bg-zinc-800 active:scale-[0.98] text-white py-3.5 rounded-xl text-[13px] font-medium transition-all">
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// 2. DATA EXPORT ENGINE & AI VALIDATOR
// ==========================================
const exportToExcel = (data) => {
  if (data.length === 0) return alert("Belum ada data untuk diekspor.");
  
  const bom = '\uFEFF';
  const headers = [
    'ID_Sensus', 'Waktu_Input', 'NIK', 'Kepala_Keluarga', 'Desa', 'RT_RW', 
    'Usia', 'Jml_Anggota', 'Pendidikan', 'Pekerjaan', 'Pendapatan', 
    'Status_Rumah', 'Lantai', 'Sumber_Air', 'Aset_Motor', 'Aset_Kulkas', 'Aset_Ternak',
    'Latitude', 'Longitude', 'Status_AI'
  ];
  
  const rows = data.map(d => [
    d.id,
    new Date(d.timestamp).toLocaleString('id-ID').replace(/,/g, ''),
    `"${d.nik}"`, `"${d.kepalaKeluarga}"`, `"${d.wilayah}"`, `"${d.rtRw}"`,
    d.usia, d.anggotaKeluarga, `"${d.pendidikan}"`, `"${d.pekerjaan}"`, d.pendapatan,
    `"${d.statusRumah}"`, `"${d.jenisLantai}"`, `"${d.sumberAir}"`,
    d.asetMotor ? 'Ya' : 'Tidak', d.asetKulkas ? 'Ya' : 'Tidak', d.asetTernak ? 'Ya' : 'Tidak',
    d.lat, d.lng, d.validationStatus
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `CAPI_Randuagung_${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const validateFieldInput = (record) => {
  let issues = [];
  let status = 'valid';

  const usia = parseInt(record.usia) || 0;
  const pendapatan = parseInt(record.pendapatan) || 0;
  const anggota = parseInt(record.anggotaKeluarga) || 0;
  const pekerjaan = (record.pekerjaan || '').toLowerCase();
  const lantai = (record.jenisLantai || '').toLowerCase();

  if (usia < 15 && !pekerjaan.includes('pelajar') && !pekerjaan.includes('belum sekolah') && pekerjaan !== '') {
    issues.push(`Usia ${usia} tahun tapi bekerja (${record.pekerjaan})?`);
  }
  if (usia > 100) issues.push(`Usia > 100 tahun. Perlu cek fisik KTP.`);
  if (anggota > 9) issues.push(`Kapasitas KK ekstrem (${anggota} orang).`);
  if (pendapatan < 1000000 && (record.asetMotor || record.asetKulkas) && lantai.includes('keramik/granit')) {
    issues.push(`Anomali Ekonomi: Pendapatan < 1 Juta, tapi memiliki aset berharga & lantai keramik.`);
  }
  if (pekerjaan.includes('penganggur') && pendapatan > 2500000) {
    issues.push(`Pengangguran tapi income Rp ${pendapatan.toLocaleString('id-ID')}. Cek sumber dana.`);
  }
  if (record.statusRumah === 'Milik Sendiri' && pendapatan < 500000 && record.asetTernak === false) {
    issues.push(`Sangat Rentan: KK ini berpotensi tinggi prioritas Bansos.`);
  }

  if (issues.length > 0) status = 'warning';
  return { issues, status };
};

// ==========================================
// 3. MODERN UI COMPONENTS
// ==========================================
const TopBar = ({ title, isCloudSync }) => (
  <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-30 px-6 py-4 flex items-center justify-between border-b border-zinc-200/50">
    <div className="flex items-center space-x-2">
      <div className="w-8 h-8 bg-zinc-900 rounded-[10px] flex items-center justify-center shadow-inner">
        <Zap size={16} className="text-white" />
      </div>
      <div>
        <h1 className="font-bold text-zinc-900 text-[15px] tracking-tight leading-tight">{title}</h1>
        <p className="text-[10px] text-zinc-500 font-medium tracking-wide uppercase">CAPI BPS System</p>
      </div>
    </div>
    <div className="flex items-center space-x-1.5 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
      <span className={`w-1.5 h-1.5 rounded-full ${isCloudSync ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'}`}></span>
      <span className={`text-[10px] font-bold ${isCloudSync ? 'text-blue-700' : 'text-amber-700'}`}>
        {isCloudSync ? 'Cloud Sync' : 'Local Mode'}
      </span>
    </div>
  </header>
);

const FloatingDock = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'home', icon: Activity, label: 'Target' },
    { id: 'input', icon: Plus, label: 'CAPI' },
    { id: 'history', icon: Layers, label: 'Data' }
  ];

  return (
    <div className="fixed bottom-6 w-full max-w-md left-1/2 -translate-x-1/2 px-6 z-40">
      <div className="bg-white/90 backdrop-blur-2xl rounded-full px-2 py-2 flex justify-between items-center shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-zinc-200/60">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 rounded-full transition-all duration-300 ease-out ${isActive ? 'bg-zinc-900 text-white shadow-md' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'}`}
            >
              <tab.icon size={20} strokeWidth={isActive ? 2.5 : 2} className="mb-1" />
              <span className={`text-[10px] font-semibold tracking-wide ${isActive ? 'text-zinc-100' : 'text-transparent hidden'}`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const InputGroup = ({ label, children }) => (
  <div className="flex flex-col space-y-2">
    <label className="text-[12px] font-semibold text-zinc-500 ml-1">{label}</label>
    {children}
  </div>
);

// ==========================================
// 4. MAIN VIEWS (WITH FIREBASE CLOUD SYNC)
// ==========================================
const AppContent = () => {
  const [activeTab, setActiveTab] = useState('home');
  const [entries, setEntries] = useState([]);
  const [user, setUser] = useState(null);
  
  const dailyTarget = 20;
  const completedToday = entries.filter(e => {
    try { return new Date(e.timestamp).toDateString() === new Date().toDateString(); } 
    catch(err) { return false; }
  }).length;

  // INJECT PWA META TAGS FOR iOS FULLSCREEN SUPPORT
  useEffect(() => {
    const metaTags = [
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no' }
    ];
    
    metaTags.forEach(({ name, content }) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    });
  }, []);

  // FIREBASE CLOUD SYNC INIT
  useEffect(() => {
    if (!isCloudAvailable) {
      // Fallback for non-gemini environment deployment
      const saved = localStorage.getItem('geoSensusLocalFallback');
      if (saved) setEntries(JSON.parse(saved));
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) { console.error("Auth error:", error); }
    };
    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, setUser);
    return () => unsubscribeAuth();
  }, []);

  // FETCH DATA FROM CLOUD REALTIME
  useEffect(() => {
    if (!isCloudAvailable || !user) return;

    const entriesRef = collection(db, 'artifacts', appId, 'users', user.uid, 'sensus_data');
    const unsubscribeData = onSnapshot(entriesRef, (snapshot) => {
      const cloudData = [];
      snapshot.forEach(doc => cloudData.push(doc.data()));
      // Sort Rule 2: Sort in memory, latest first
      cloudData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setEntries(cloudData);
    }, (error) => console.error("Firestore Listen Error:", error));

    return () => unsubscribeData();
  }, [user]);

  // SAVE TO CLOUD
  const handleSaveEntry = async (data) => {
    if (isCloudAvailable && user) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'sensus_data', data.id);
        await setDoc(docRef, data);
        setActiveTab('history'); 
      } catch (err) {
        alert("Gagal sinkronisasi Cloud. Pastikan koneksi aktif.");
      }
    } else {
      // Offline / Deployment fallback
      const newEntries = [data, ...entries];
      setEntries(newEntries);
      localStorage.setItem('geoSensusLocalFallback', JSON.stringify(newEntries));
      setActiveTab('history');
    }
  };

  return (
    <div className="flex justify-center bg-[#F3F4F6] min-h-screen font-sans selection:bg-zinc-200">
      <div className="w-full max-w-md bg-[#FAFAFA] min-h-screen relative flex flex-col overflow-hidden pb-32 shadow-2xl ring-1 ring-zinc-200/50">
        <TopBar title={activeTab === 'input' ? 'Kuesioner Terpadu' : 'Dashboard Enumerator'} isCloudSync={isCloudAvailable && user} />

        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {activeTab === 'home' && <HomeView completed={completedToday} target={dailyTarget} setActiveTab={setActiveTab} />}
          {activeTab === 'input' && <CAPIWizardView onSave={handleSaveEntry} onCancel={() => setActiveTab('home')} />}
          {activeTab === 'history' && <HistoryView entries={entries} onExport={() => exportToExcel(entries)} isCloudSync={isCloudAvailable && user} />}
        </main>

        {activeTab !== 'input' && <FloatingDock activeTab={activeTab} setActiveTab={setActiveTab} />}
      </div>
    </div>
  );
};

// --- VIEW 1: HOME ---
const HomeView = ({ completed, target, setActiveTab }) => {
  const progress = Math.min((completed / target) * 100, 100);

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <div className="pt-6 pb-6">
        <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mb-4 flex items-center">
          <Activity size={12} className="mr-1.5"/> Target Regsosek / Susenas
        </p>
        <div className="flex items-baseline space-x-1 mb-6">
          <h2 className="text-7xl font-semibold text-zinc-900 tracking-tighter" style={{ fontFeatureSettings: '"tnum"' }}>{completed}</h2>
          <span className="text-2xl font-medium text-zinc-300">/ {target}</span>
        </div>
        <div className="w-full bg-zinc-200/60 rounded-full h-1 mb-3 overflow-hidden">
          <div className="bg-zinc-900 h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${progress}%` }}></div>
        </div>
        <p className="text-[13px] text-zinc-500 font-medium">
          {target - completed > 0 ? `${target - completed} beban tugas (KK) tersisa hari ini.` : `Target hari ini telah terpenuhi.`}
        </p>
      </div>

      <button 
        onClick={() => setActiveTab('input')}
        className="w-full bg-white border border-zinc-200/80 p-5 rounded-[20px] flex items-center justify-between hover:border-zinc-300 hover:shadow-sm active:scale-[0.98] transition-all group"
      >
        <div className="flex items-center space-x-4">
          <div className="bg-zinc-50 text-zinc-900 p-3 rounded-2xl group-hover:bg-zinc-100 transition-colors">
            <Plus size={20} strokeWidth={2.5} />
          </div>
          <div className="text-left">
            <p className="font-semibold text-[15px] text-zinc-900">Mulai Kuesioner (CAPI)</p>
            <p className="text-[12px] text-zinc-500 mt-0.5">Form komprehensif Blok I - IV</p>
          </div>
        </div>
        <ChevronRight size={18} className="text-zinc-300 group-hover:text-zinc-500 transition-colors" />
      </button>
    </div>
  );
};

// --- VIEW 2: FULL CAPI WIZARD ---
const CAPIWizardView = ({ onSave, onCancel }) => {
  const mapRef = useRef(null);
  const [step, setStep] = useState(1);
  const totalSteps = 4;
  
  const [formData, setFormData] = useState({
    wilayah: '', rtRw: '', customVillage: '', lat: -8.0833, lng: 113.3167,
    nik: '', kepalaKeluarga: '', usia: '', anggotaKeluarga: '', pendidikan: '',
    pekerjaan: '', pendapatan: '',
    statusRumah: '', jenisLantai: '', sumberAir: '', asetMotor: false, asetKulkas: false, asetTernak: false
  });

  const [aiWarning, setAiWarning] = useState(null);
  const [isFetchingGPS, setIsFetchingGPS] = useState(false);
  
  const desaRanduagung = ['Banyuputih Lor', 'Buwek', 'Gedangmas', 'Kalidilem', 'Kalipenggung', 'Ledoktempuro', 'Pejarakan', 'Randuagung', 'Ranuwurung', 'Salak', 'Tunjung', 'Lainnya...'];

  useEffect(() => {
    const validation = validateFieldInput(formData);
    setAiWarning(validation.status === 'warning' ? validation.issues : null);
  }, [formData]);

  useEffect(() => {
    if (step !== 1) return;
    let isMounted = true;
    
    const initMap = async () => {
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link'); link.id = 'leaflet-css'; link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
      }
      if (!window.L) {
        const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        document.head.appendChild(script); await new Promise(r => script.onload = r);
      }

      setTimeout(() => {
        const container = document.getElementById('step-map');
        if (!container || !isMounted) return; 
        if (container._leaflet_id) container._leaflet_id = null;
        if (!mapRef.current) {
          const map = window.L.map('step-map', { zoomControl: false, attributionControl: false }).setView([formData.lat, formData.lng], 14);
          window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);
          const marker = window.L.marker([formData.lat, formData.lng], { draggable: true }).addTo(map);
          
          map.on('click', e => { 
            marker.setLatLng(e.latlng); 
            setFormData(p => ({ ...p, lat: e.latlng.lat, lng: e.latlng.lng })); 
          });
          marker.on('dragend', () => { 
            const pos = marker.getLatLng(); 
            setFormData(p => ({ ...p, lat: pos.lat, lng: pos.lng })); 
          });

          mapRef.current = map;
          setTimeout(() => map.invalidateSize(), 200);
        }
      }, 100);
    };
    initMap();

    return () => {
      isMounted = false;
      if (mapRef.current) { mapRef.current.off(); mapRef.current.remove(); mapRef.current = null; }
    };
  }, [step]);

  const handleChange = (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFormData({ ...formData, [e.target.name]: value });
  };

  const nextStep = () => {
    if (step === 1) {
      if (!formData.wilayah) return alert("Pilih wilayah desa terlebih dahulu.");
      if (formData.wilayah === 'Lainnya...' && !formData.customVillage.trim()) return alert("Ketik nama desa manual secara lengkap!");
    }
    if (step === 2) {
      if (!formData.nik || !formData.kepalaKeluarga) return alert("NIK dan Nama Kepala Keluarga wajib diisi.");
    }
    if (step === 3) {
      if (!formData.pekerjaan || !formData.pendapatan) return alert("Lengkapi data pekerjaan dan estimasi pendapatan.");
    }
    setStep(prev => Math.min(prev + 1, totalSteps));
  };
  
  const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

  const handleFinalSubmit = () => {
    let finalWilayah = formData.wilayah;
    if (formData.wilayah === 'Lainnya...') {
      finalWilayah = formData.customVillage;
    }

    if (aiWarning && aiWarning.length > 0) {
      if(!window.confirm("AI menemukan kejanggalan data. Anda yakin ingin mensubmit data ini ke server lokal?")) return;
    }

    const validation = validateFieldInput(formData);
    onSave({
      ...formData,
      wilayah: finalWilayah,
      id: `CAPI-${Math.floor(Math.random()*90000) + 10000}`,
      timestamp: new Date().toISOString(),
      validationStatus: validation.status,
      aiIssues: validation.issues
    });
  };

  const getGPS = () => {
    if (!navigator.geolocation) return alert("Perangkat tidak mendukung Geolocation.");
    setIsFetchingGPS(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setFormData(prev => ({ ...prev, lat, lng }));
        if (mapRef.current) {
          mapRef.current.flyTo([lat, lng], 17, { animate: true, duration: 1.5 });
          mapRef.current.eachLayer(layer => { 
            if (layer instanceof window.L.Marker) layer.setLatLng([lat, lng]);
          });
        }
        setIsFetchingGPS(false);
      },
      (err) => {
        setIsFetchingGPS(false);
        let msg = "Terjadi kesalahan GPS.";
        if (err.code === 1) msg = "Izin Lokasi Ditolak. Harap izinkan akses lokasi.";
        else if (err.code === 2) msg = "Sinyal GPS tidak tersedia.";
        else if (err.code === 3) msg = "Waktu pencarian lokasi habis.";
        alert(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const StepIndicators = [
    { icon: MapPin, title: 'Tempat' },
    { icon: Users, title: 'Keluarga' },
    { icon: HardDrive, title: 'Ekonomi' },
    { icon: Home, title: 'Aset' }
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-70px)] bg-white absolute inset-0 z-50 animate-in slide-in-from-bottom-8 duration-300">
      <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-white shrink-0">
        <button onClick={onCancel} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-900">Batal</button>
        <span className="text-[11px] font-bold text-zinc-900 uppercase tracking-widest">CAPI Form • {step}/{totalSteps}</span>
      </div>

      <div className="px-8 pt-6 pb-2 shrink-0">
        <div className="flex justify-between items-center relative mb-2">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-zinc-100 -z-10"></div>
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-zinc-900 -z-10 transition-all duration-300" style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}></div>
          
          {StepIndicators.map((ind, idx) => (
            <div key={idx} className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 bg-white ${step >= idx + 1 ? 'border-zinc-900 text-zinc-900' : 'border-zinc-200 text-zinc-300'}`}>
              <ind.icon size={14} strokeWidth={2.5}/>
            </div>
          ))}
        </div>
        <div className="text-center mt-4">
          <h2 className="text-lg font-bold text-zinc-900">Blok {['I. Tempat & Lokasi', 'II. Identitas Anggota', 'III. Pekerjaan & Income', 'IV. Perumahan & Aset'][step-1]}</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar pb-24">
        
        {step === 1 && (
          <div className="space-y-5 animate-in fade-in">
            <InputGroup label="Kecamatan">
              <input type="text" value="Randuagung" disabled className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-[14px] text-[14px] text-zinc-500 outline-none" />
            </InputGroup>
            <InputGroup label="Desa / Kelurahan">
              <div className="relative">
                <select name="wilayah" value={formData.wilayah} onChange={handleChange} className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none appearance-none shadow-sm text-zinc-700">
                  <option value="" disabled>-- Pilih Desa --</option>
                  {desaRanduagung.map(desa => <option key={desa} value={desa === 'Lainnya...' ? desa : `Desa ${desa}`}>{desa === 'Lainnya...' ? desa : `Desa ${desa}`}</option>)}
                </select>
                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 rotate-90 pointer-events-none" size={16}/>
              </div>
              {formData.wilayah === 'Lainnya...' && (
                <input type="text" name="customVillage" value={formData.customVillage} onChange={handleChange} placeholder="Ketik nama desa manual..." className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-[14px] text-[14px] outline-none mt-2 animate-in fade-in focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900" required/>
              )}
            </InputGroup>
            <InputGroup label="Nama SLS / RT / RW (Opsional)">
              <input type="text" name="rtRw" value={formData.rtRw} onChange={handleChange} className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none shadow-sm" placeholder="Cth: RT 02 / RW 04" />
            </InputGroup>
            
            <div className="pt-2 space-y-3">
              <div className="flex flex-col space-y-2">
                <label className="text-[12px] font-semibold text-zinc-500 ml-1">Kordinat GPS Rumah (Wajib Akurat)</label>
                <button 
                  type="button" 
                  onClick={getGPS} 
                  disabled={isFetchingGPS}
                  className={`w-full py-3.5 rounded-[14px] text-[13px] font-bold shadow-sm transition-all flex justify-center items-center ${
                    isFetchingGPS ? 'bg-zinc-100 text-zinc-400 border border-zinc-200 cursor-not-allowed' : 'bg-white border border-zinc-200 text-zinc-900 hover:bg-zinc-50 active:scale-[0.98]'
                  }`}
                >
                  {isFetchingGPS ? <><Loader2 size={16} className="mr-2 animate-spin text-blue-500" /> Mengunci Satelit...</> : <><MapPin size={16} className="mr-2 text-blue-500" /> Tembak GPS Lokasi</>}
                </button>
              </div>

              <div className="rounded-[16px] overflow-hidden border border-zinc-200 bg-zinc-100 relative h-48 shadow-inner">
                {isFetchingGPS && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center animate-in fade-in">
                    <span className="bg-zinc-900 text-white px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase flex items-center shadow-lg">
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-2 animate-ping"></div> Syncing Map
                    </span>
                  </div>
                )}
                <div id="step-map" className="w-full h-full z-0"></div>
              </div>
              <div className="flex gap-2 justify-center">
                <span className="text-[10px] font-mono bg-zinc-100 px-2 py-1 rounded border border-zinc-200 text-zinc-500">Lat: {formData.lat.toFixed(5)}</span>
                <span className="text-[10px] font-mono bg-zinc-100 px-2 py-1 rounded border border-zinc-200 text-zinc-500">Lng: {formData.lng.toFixed(5)}</span>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 animate-in fade-in">
            <InputGroup label="NIK (Nomor Induk Kependudukan)">
              <input type="number" name="nik" value={formData.nik} onChange={handleChange} required className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none font-mono shadow-sm" placeholder="16 Digit NIK Resmi" />
            </InputGroup>
            <InputGroup label="Nama Kepala Keluarga (KRT)">
              <input type="text" name="kepalaKeluarga" value={formData.kepalaKeluarga} onChange={handleChange} required className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none shadow-sm" placeholder="Nama Sesuai KTP" />
            </InputGroup>
            <div className="grid grid-cols-2 gap-4">
              <InputGroup label="Umur (Thn)">
                <input type="number" name="usia" value={formData.usia} onChange={handleChange} className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none shadow-sm" />
              </InputGroup>
              <InputGroup label="Jml Anggota KK">
                <input type="number" name="anggotaKeluarga" value={formData.anggotaKeluarga} onChange={handleChange} className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none shadow-sm" />
              </InputGroup>
            </div>
            <InputGroup label="Pendidikan Tertinggi KRT">
              <div className="relative">
                <select name="pendidikan" value={formData.pendidikan} onChange={handleChange} className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none shadow-sm appearance-none">
                  <option value="">-- Pilih Pendidikan --</option>
                  <option value="Tidak Sekolah">Tidak/Belum Pernah Sekolah</option>
                  <option value="SD">SD / Sederajat</option>
                  <option value="SMP">SMP / Sederajat</option>
                  <option value="SMA">SMA / Sederajat</option>
                  <option value="Perguruan Tinggi">Perguruan Tinggi (D1-S3)</option>
                </select>
                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 rotate-90 pointer-events-none" size={16}/>
              </div>
            </InputGroup>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5 animate-in fade-in">
            <InputGroup label="Status Pekerjaan Utama">
              <div className="relative">
                <select name="pekerjaan" value={formData.pekerjaan} onChange={handleChange} className="w-full px-4 py-3.5 bg-white border border-zinc-200 rounded-[14px] text-[14px] focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 outline-none shadow-sm appearance-none">
                  <option value="">-- Pilih Pekerjaan --</option>
                  <option value="Petani / Pekebun">Berusaha Sendiri (Petani/Pedagang)</option>
                  <option value="Buruh Tani / Kasar">Buruh Tani / Kuli Bangunan</option>
                  <option value="Karyawan Swasta">Buruh / Karyawan Tetap</option>
                  <option value="PNS / TNI / POLRI">PNS / TNI / POLRI</option>
                  <option value="Pengangguran">Belum / Tidak Bekerja (Penganggur)</option>
                  <option value="Mengurus Rumah Tangga">Mengurus Rumah Tangga / Pensiunan</option>
                </select>
                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 rotate-90 pointer-events-none" size={16}/>
              </div>
            </InputGroup>
            <InputGroup label="Est. Pendapatan/Pengeluaran Sebulan">
              <div className="relative flex items-center shadow-sm rounded-[14px] border border-zinc-200 focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900 bg-white">
                <span className="absolute left-4 font-mono text-zinc-400 font-bold">Rp</span>
                <input type="number" name="pendapatan" value={formData.pendapatan} onChange={handleChange} className="w-full pl-12 pr-4 py-3.5 bg-transparent text-[14px] outline-none font-mono" placeholder="Tanpa titik" />
              </div>
            </InputGroup>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6 animate-in fade-in pb-10">
            <div className="space-y-4">
              <h3 className="text-[12px] font-bold text-zinc-900 border-b border-zinc-100 pb-2">Kondisi Bangunan</h3>
              <InputGroup label="Status Penguasaan Bangunan">
                <select name="statusRumah" value={formData.statusRumah} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-[12px] text-[13px] outline-none">
                  <option value="">-- Pilih --</option>
                  <option value="Milik Sendiri">Milik Sendiri</option>
                  <option value="Kontrak / Sewa">Kontrak / Sewa</option>
                  <option value="Bebas Sewa (Numpang)">Bebas Sewa (Numpang)</option>
                </select>
              </InputGroup>
              <InputGroup label="Jenis Lantai Terluas">
                <select name="jenisLantai" value={formData.jenisLantai} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-[12px] text-[13px] outline-none">
                  <option value="">-- Pilih --</option>
                  <option value="Keramik/Granit/Marmer">Keramik / Granit / Marmer</option>
                  <option value="Semen/Bata Merah">Semen / Bata Merah</option>
                  <option value="Kayu/Bambu Kualitas Rendah">Kayu / Bambu</option>
                  <option value="Tanah">Tanah</option>
                </select>
              </InputGroup>
              <InputGroup label="Sumber Air Minum Utama">
                <select name="sumberAir" value={formData.sumberAir} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-[12px] text-[13px] outline-none">
                  <option value="">-- Pilih --</option>
                  <option value="Air Kemasan/Isi Ulang">Leding / Kemasan / Isi Ulang</option>
                  <option value="Sumur/Mata Air Terlindung">Sumur Bor / Pompa</option>
                  <option value="Mata Air Tidak Terlindung/Sungai">Sungai / Mata Air Tidak Terlindung</option>
                </select>
              </InputGroup>
            </div>

            <div className="space-y-3 pt-2">
              <h3 className="text-[12px] font-bold text-zinc-900 border-b border-zinc-100 pb-2">Kepemilikan Aset</h3>
              <label className="flex items-center space-x-3 p-3 bg-white border border-zinc-200 rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors">
                <input type="checkbox" name="asetMotor" checked={formData.asetMotor} onChange={handleChange} className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
                <span className="text-[13px] font-medium text-zinc-700">Kendaraan Bermotor (Roda 2/4)</span>
              </label>
              <label className="flex items-center space-x-3 p-3 bg-white border border-zinc-200 rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors">
                <input type="checkbox" name="asetKulkas" checked={formData.asetKulkas} onChange={handleChange} className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
                <span className="text-[13px] font-medium text-zinc-700">Kulkas / Lemari Pendingin</span>
              </label>
              <label className="flex items-center space-x-3 p-3 bg-white border border-zinc-200 rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors">
                <input type="checkbox" name="asetTernak" checked={formData.asetTernak} onChange={handleChange} className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
                <span className="text-[13px] font-medium text-zinc-700">Hewan Ternak (Sapi/Kambing)</span>
              </label>
            </div>

            {aiWarning && aiWarning.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-[16px] animate-in slide-in-from-bottom-2 shadow-sm mt-4">
                <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest mb-2 flex items-center">
                  <AlertCircle size={14} className="mr-1.5"/> Review AI
                </p>
                <ul className="text-[12px] text-amber-700 space-y-1.5 list-disc pl-4 leading-relaxed font-medium">
                  {aiWarning.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="p-4 bg-white border-t border-zinc-100 flex items-center justify-between shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
        {step > 1 ? (
          <button onClick={prevStep} className="flex items-center px-5 py-3.5 rounded-[14px] text-[14px] font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors">
            <ChevronLeft size={18} className="mr-1"/> Mundur
          </button>
        ) : <div className="px-5"/>}

        {step < totalSteps ? (
          <button onClick={nextStep} className="flex items-center px-6 py-3.5 rounded-[14px] text-[14px] font-semibold text-white bg-zinc-900 hover:bg-zinc-800 active:scale-95 transition-all shadow-md">
            Blok {step + 1} <ChevronRight size={18} className="ml-1"/>
          </button>
        ) : (
          <button onClick={handleFinalSubmit} className={`flex items-center px-6 py-3.5 rounded-[14px] text-[14px] font-semibold text-white active:scale-95 transition-all shadow-md ${aiWarning && aiWarning.length > 0 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
            <Send size={16} className="mr-2"/> Simpan Akhir
          </button>
        )}
      </div>
    </div>
  );
};

// --- VIEW 3: HISTORY & EXCEL EXPORT ---
const HistoryView = ({ entries, onExport, isCloudSync }) => {
  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-2">
        <div>
           <h2 className="font-semibold text-zinc-900 text-xl tracking-tight">Database Lapangan</h2>
           <p className="text-[12px] text-zinc-500 mt-0.5 flex items-center">
             {isCloudSync ? <CloudLightning size={12} className="mr-1 text-blue-500"/> : null}
             {isCloudSync ? 'Tersimpan otomatis ke Cloud.' : 'Tersimpan di memori lokal.'}
           </p>
        </div>
        {entries.length > 0 && (
          <button onClick={onExport} className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-4 py-2.5 rounded-[12px] font-semibold text-[12px] flex items-center transition-colors border border-emerald-200/50 active:scale-95">
            <FileSpreadsheet size={16} className="mr-2" /> Export
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="py-24 text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-white rounded-[16px] flex items-center justify-center mb-4 border border-zinc-200/60 shadow-sm">
            <Layers size={24} className="text-zinc-300" strokeWidth={1.5} />
          </div>
          <h3 className="font-medium text-zinc-900 text-[15px]">Data Kosong</h3>
          <p className="text-[13px] text-zinc-400 mt-1 max-w-[200px]">Rekaman hasil wawancara (CAPI) akan muncul di sini.</p>
        </div>
      ) : (
        <div className="space-y-4 pb-20">
          {entries.map((item, idx) => {
            let timeStr = '-';
            try { timeStr = new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); } catch(e){}
            
            return (
              <div key={idx} className="bg-white p-5 rounded-[20px] shadow-sm border border-zinc-200/60 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-semibold text-zinc-900 text-[15px] pr-2">{item.kepalaKeluarga}</h3>
                    <div className="flex items-center space-x-2 mt-1">
                       <span className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded border border-zinc-100">{item.nik}</span>
                       <span className="text-[10px] text-zinc-400 font-medium">{timeStr}</span>
                    </div>
                  </div>
                  {item.validationStatus === 'warning' ? (
                    <span className="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-md text-[10px] font-bold shrink-0 border border-amber-100/50">AI Alert</span>
                  ) : (
                    <span className="bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-md text-[10px] font-bold shrink-0 border border-emerald-100/50">Clean</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[10px] font-medium bg-zinc-50 text-zinc-600 px-2.5 py-1.5 rounded-lg border border-zinc-100">{item.wilayah}</span>
                  <span className="text-[10px] font-medium bg-zinc-50 text-zinc-600 px-2.5 py-1.5 rounded-lg border border-zinc-100">{item.pekerjaan || 'Tanpa Profesi'}</span>
                  <span className="text-[10px] font-medium bg-zinc-50 text-zinc-600 px-2.5 py-1.5 rounded-lg border border-zinc-100">{item.usia || '-'} Thn</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
