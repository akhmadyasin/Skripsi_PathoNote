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

export default function PasienPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasien, setPasien] = useState<MasterPasien | null>(null);
  const [riwayat, setRiwayat] = useState<PathologyRecord[]>([]);

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
        setRiwayat(Array.isArray(payload.riwayat) ? payload.riwayat : []);
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
                {riwayat.map((item, index) => (
                  <div key={item.id || index} style={{ border: '1px solid #e2e8f0', borderRadius: 16, padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                      <div style={{ fontWeight: 600 }}>
                        {item.nama_pasien || item.kunjungan ? `Pasien ${item.nama_pasien || item.kunjungan}` : 'Riwayat PA'}
                      </div>
                      {item.id ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/detail/${item.id}`)}
                          style={{ border: 'none', borderRadius: 999, background: '#38b6ff', color: '#fff', padding: '8px 12px', cursor: 'pointer', fontWeight: 700 }}
                        >
                          Lihat Detail
                        </button>
                      ) : null}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {renderField('Nomor PA', item.nomor_pa)}
                      {renderField('Tanggal', item.tanggal)}
                      {renderField('Jaringan', item.jaringan)}
                      {renderField('Lokasi', item.lokasi)}
                      {renderField('Diagnosa Klinik', item.diagnosa_klinik)}
                      {renderField('Keterangan Klinik', item.keterangan_klinik)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
