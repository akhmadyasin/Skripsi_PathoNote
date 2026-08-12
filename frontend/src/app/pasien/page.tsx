"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

type MasterPasien = {
  no_rm: string;
  nama_pasien?: string;
  umur?: string;
  jenis_kelamin?: string;
  alamat?: string;
  [k: string]: any;
};

type PathologyRecord = Record<string, any>;

const flattenRiwayatItem = (item: PathologyRecord) => {
  if (!item || typeof item !== 'object') return item;

  const flattened: PathologyRecord = { ...item };
  const pendaftaran = Array.isArray(item.pendaftaran_pa) ? item.pendaftaran_pa[0] : item.pendaftaran_pa;
  const pasien = Array.isArray(pendaftaran?.master_pasien) ? pendaftaran.master_pasien[0] : pendaftaran?.master_pasien;

  const pendaftaranKeys = [
    'id',
    'no_kunjungan',
    'nomor_pa',
    'pa_sebelumnya',
    'jaringan',
    'lokasi',
    'cairan_fiksasi',
    'diagnosa_klinik',
    'keterangan_klinik',
    'asisten',
    'didapat_dengan',
    'dokter_perujuk',
    'unit_pengantar',
  ];

  pendaftaranKeys.forEach((key) => {
    if ((flattened[key] === undefined || flattened[key] === null || flattened[key] === '') && pendaftaran?.[key] != null) {
      flattened[key] = pendaftaran[key];
    }
  });

  const pasienKeys = ['no_rm', 'nama_pasien', 'jenis_kelamin', 'tgl_lahir', 'umur', 'alamat'];
  pasienKeys.forEach((key) => {
    if ((flattened[key] === undefined || flattened[key] === null || flattened[key] === '') && pasien?.[key] != null) {
      flattened[key] = pasien[key];
    }
  });

  delete flattened.pendaftaran_pa;
  delete flattened.master_pasien;

  return flattened;
};

export default function PasienPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasien, setPasien] = useState<MasterPasien | null>(null);
  const [riwayat, setRiwayat] = useState<PathologyRecord[]>([]);
  const [userRole, setUserRole] = useState<string>("");

  useEffect(() => {
    const loadRole = async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      const role = (session?.user?.user_metadata?.role || "").toString().toLowerCase();
      setUserRole(role);
    };

    loadRole();
  }, []);

  const normalizeRm = (value: string) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    return trimmed.match(/^\d+$/) && trimmed.length === 1 ? trimmed.padStart(2, "0") : trimmed;
  };

  const fetchData = async () => {
    const normalized = normalizeRm(query);
    if (!normalized) {
      setError("Masukkan nomor RM pasien yang valid.");
      setPasien(null);
      setRiwayat([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/pasien/${encodeURIComponent(normalized)}/riwayat`);
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        setError(payload.message || payload.error || "Data pasien tidak ditemukan.");
        setPasien(null);
        setRiwayat([]);
      } else {
        setPasien(payload.pasien || null);
        setRiwayat(Array.isArray(payload.riwayat) ? payload.riwayat.map(flattenRiwayatItem) : []);
      }
    } catch (err) {
      setError("Gagal mengambil data pasien. Coba lagi.");
      setPasien(null);
      setRiwayat([]);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (label: string, value: any) => (
    <div style={{ marginBottom: 10 }}>
      <strong>{label}:</strong> {value ?? '-'}
    </div>
  );

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fbff 0%, #eef8ff 100%)', padding: 24 }}>
      <div style={{ maxWidth: 1600, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Rekam Medis Pasien</h1>
            <p style={{ margin: '8px 0 0', color: '#475569' }}>
              Cari data pasien berdasarkan No. RM dan lihat riwayat hasil patologi.
            </p>
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, padding: 24, marginBottom: 24, boxShadow: '0 20px 45px rgba(15, 23, 42, 0.06)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Masukkan No. RM pasien, misal 01"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  fetchData();
                }
              }}
              style={{ flex: 1, minWidth: 240, padding: '12px 14px', borderRadius: 14, border: '1px solid #cbd5e1' }}
            />
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              style={{ padding: '12px 18px', borderRadius: 14, border: 'none', background: '#38b6ff', color: '#fff', cursor: 'pointer' }}
            >
              {loading ? 'Memuat...' : 'Cari Pasien'}
            </button>
          </div>
          {error && <div style={{ marginTop: 14, color: '#b91c1c' }}>{error}</div>}
        </div>

        {pasien && (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 20, padding: 24, marginBottom: 24, boxShadow: '0 20px 45px rgba(15, 23, 42, 0.06)' }}>
            <h2 style={{ marginTop: 0 }}>Profil Pasien</h2>
            {renderField('No. RM', pasien.no_rm)}
            {renderField('Nama Pasien', pasien.nama_pasien)}
            {renderField('Umur', pasien.umur)}
            {renderField('Jenis Kelamin', pasien.jenis_kelamin)}
            {renderField('Alamat', pasien.alamat)}
          </div>
        )}

        {pasien && (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 20, padding: 24, boxShadow: '0 20px 45px rgba(15, 23, 42, 0.06)' }}>
            <h2 style={{ marginTop: 0 }}>Riwayat Hasil Patologi</h2>
            {riwayat.length === 0 ? (
              <div style={{ color: '#475569' }}>Belum ada riwayat hasil patologi untuk pasien ini.</div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {riwayat.map((item, index) => {
                  const isExpanded = !!expandedIds[String(item.id || index)];
                  return (
                    <div key={item.id || index} style={{ border: '1px solid #e2e8f0', borderRadius: 16, padding: 18 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                        <div style={{ fontSize: 18, color: '#0f172a' }}>
                          <span style={{ fontWeight: 700, color: '#334155', marginRight: 6 }}>Nama :</span>
                          <span style={{ fontWeight: 400 }}>{item.nama_pasien || 'Pasien'}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(String(item.id || index))}
                          style={{ border: '1px solid #cbd5e1', borderRadius: 999, background: '#f8fafc', color: '#0f172a', padding: '8px 14px', cursor: 'pointer', fontWeight: 700 }}
                        >
                          {isExpanded ? 'Sembunyikan' : 'Lihat Detail'}
                        </button>
                      </div>

                      <div style={{ display: 'grid', gap: 10 }}>
                        {renderField('Nomor PA', item.nomor_pa || item.nomor_pa_pa || item.nomor_pa_id || '-')}
                        {renderField('Tanggal', item.tanggal || '-')}
                      </div>

                      {isExpanded && (
                        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                          {renderField('Jaringan', item.jaringan)}
                          {renderField('Lokasi', item.lokasi)}
                          {renderField('Diperoleh dengan', item.didapat_dengan)}
                          {renderField('Cairan Fiksasi', item.cairan_fiksasi)}
                          {renderField('Makroskopik', item.makroskopik)}
                          {renderField('Mikroskopik', item.mikroskopik)}
                          {renderField('Kesimpulan', item.kesimpulan)}
                          {renderField('Diagnosa Klinik', item.diagnosa_klinik)}
                          {renderField('Keterangan Klinik', item.keterangan_klinik)}
                          {item.id && userRole !== 'dokter' ? (
                            <button
                              type="button"
                              onClick={() => router.push(`/detail/${item.id}`)}
                              style={{ marginTop: 8, border: 'none', borderRadius: 999, background: '#38b6ff', color: '#fff', padding: '8px 12px', cursor: 'pointer', fontWeight: 700, width: 'fit-content' }}
                            >
                              Buka Semua Detail
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
