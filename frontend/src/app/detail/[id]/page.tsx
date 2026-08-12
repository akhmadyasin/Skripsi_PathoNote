"use client";

import { useEffect, useState } from "react";
import { format } from 'date-fns';
import { useRouter, useParams } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

import s from "@/app/styles/dashboard.module.css";
import d from "@/app/styles/detail.module.css";
import h from "@/app/styles/collections.module.css";

type UserMeta = {
  username?: string;
  avatar_url?: string;
  [k: string]: any;
};

type PathologyRecord = Record<string, any>;

const REPORT_FIELD_ORDER = [
  'kunjungan',
  'tanggal',
  'waktu',
  'nomor_pa',
  'id_simgos',
  'jenis_pemeriksaan',
  'pa_sebelumnya',
  'asisten',
  'dokter',
  'oleh',
  'status',
  'status_data',
  'status_pengiriman',
  'jaringan',
  'lokasi',
  'topography',
  'morphology',
  'grade',
  'perilaku_tumor',
  'didapat_dengan',
  'cairan_fiksasi',
  'diagnosa_klinik',
  'keterangan_klinik',
  'makroskopik',
  'mikroskopik',
  'kesimpulan',
  'permintaan_ihc',
  'imuno_histokimia',
  'bukan_tumor',
  'reevolusi',
  'tanggal_imuno',
  'created_at',
  'user_id',
];

const FIELD_LABELS: Record<string, string> = {
  MAKROSKOPIK: 'Makroskopik',
  MIKROSKOPIK: 'Mikroskopik',
  KESIMPULAN: 'Kesimpulan',
  JARINGAN: 'Jaringan',
  LOKASI: 'Lokasi',
  DIAGNOSA_KLINIK: 'Diagnosa Klinik',
  KETERANGAN_KLINIK: 'Keterangan Klinik',
  DIDAPAT_DENGAN: 'Diperoleh dengan',
  CAIRAN_FIKSASI: 'Cairan Fiksasi',
};

const ICDO_TOPOGRAPHY_OPTIONS = [
  'C50.9 - Payudara, NOS',
  'C18.9 - Kolon, NOS',
  'C34.9 - Paru-paru, NOS',
  'C16.9 - Lambung, NOS',
  'C20.9 - Rektum, NOS',
  'C44.9 - Kulit, NOS',
  'C61.9 - Prostat, NOS',
  'C67.9 - Kandung kemih, NOS',
];

const ICDO_MORPHOLOGY_OPTIONS = [
  'M8000/3 - Neoplasma ganas, NOS',
  'M8140/3 - Adenokarsinoma',
  'M8500/3 - Karsinoma duktal invasif',
  'M8830/3 - Leiomiosarkoma',
  'M9050/3 - Fibrosarkoma',
  'M8070/3 - Karsinoma skuamosa',
  'M8720/3 - Melanoma malignum',
  'M9100/3 - Fibrohistiocytoma malignum',
];

const NON_EDITABLE_FIELDS = new Set([
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'status',
  'status_data',
  'status_pengiriman',
  'diagnosa_klinik',
  'keterangan_klinik',
  'waktu',
  'permintaan_ihc',
]);

const HASIL_PATOLOGI_EDITABLE_FIELDS = new Set([
  'jenis_pemeriksaan',
  'topography',
  'morphology',
  'grade',
  'perilaku_tumor',
  'makroskopik',
  'mikroskopik',
  'kesimpulan',
  'imuno_histokimia',
  'bukan_tumor',
  'reevolusi',
  'tanggal_imuno',
  'dokter',
  'oleh',
  'status',
]);

const PENDAFTARAN_PA_EDITABLE_FIELDS = new Set([
  'asisten',
  'didapat_dengan',
  'cairan_fiksasi',
  'jaringan',
  'lokasi',
  'pa_sebelumnya',
  'dokter_perujuk',
  'unit_pengantar',
  'nomor_pa',
  'no_kunjungan',
]);

const FORBIDDEN_UPDATE_FIELDS = new Set([
  'alamat',
  'nama_pasien',
  'no_rm',
  'jenis_kelamin',
  'tgl_lahir',
  'umur',
  'pendaftaran_pa',
  'master_pasien',
  'diagnosa_klinik',
  'keterangan_klinik',
  'waktu',
]);

function isEditableField(key: string) {
  return !NON_EDITABLE_FIELDS.has(key.toLowerCase());
}

function splitEditableUpdatePayload(record: PathologyRecord, values: Partial<PathologyRecord>) {
  const hasilPatologiUpdates: Record<string, any> = {};
  const pendaftaranUpdates: Record<string, any> = {};

  Object.keys(values).forEach((key) => {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_UPDATE_FIELDS.has(normalized)) return;
    if (!isEditableField(key)) return;

    if (HASIL_PATOLOGI_EDITABLE_FIELDS.has(normalized)) {
      hasilPatologiUpdates[key] = values[key];
      return;
    }

    if (PENDAFTARAN_PA_EDITABLE_FIELDS.has(normalized) && record?.pendaftaran_id) {
      pendaftaranUpdates[key] = values[key];
    }
  });

  return { hasilPatologiUpdates, pendaftaranUpdates };
}

// Test hook: isEditableField(key)
// - Menentukan apakah field boleh diedit (bypass RLS/readonly keys)

function formatFieldName(key: string) {
  const normalized = key.toLowerCase();
  const friendly = FIELD_LABELS[normalized.toUpperCase() as keyof typeof FIELD_LABELS];
  if (friendly) return friendly;
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Test hook: formatFieldName(key)
// - Mengubah nama field teknis menjadi label yang ramah-tampilan.

function renderFieldValue(value: any) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function shouldShowIhcField(fieldKey: string, record: PathologyRecord | null) {
  if (!record) return false;

  const hasIhcRequest = Boolean(String(record.permintaan_ihc ?? '').trim());
  const jenisPemeriksaan = String(record.jenis_pemeriksaan ?? '').trim().toLowerCase();
  const isIhcCase = jenisPemeriksaan === '3' || jenisPemeriksaan === 'ihc' || jenisPemeriksaan === 'imunohistokimia';

  if (fieldKey === 'permintaan_ihc') {
    return hasIhcRequest || isIhcCase;
  }

  return hasIhcRequest || isIhcCase;
}

function normalizeRelationValue(value: any) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function flattenDetailRecord(item: PathologyRecord) {
  if (!item || typeof item !== 'object') return item;

  const flattened: PathologyRecord = { ...item };
  const pendaftaran = normalizeRelationValue(flattened.pendaftaran_pa);
  const pasien = normalizeRelationValue(pendaftaran?.master_pasien);

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
    'permintaan_ihc',
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

  // Remove raw nested relation objects once flattened to avoid duplicate/raw JSON presentation
  delete flattened.pendaftaran_pa;
  delete flattened.master_pasien;

  return flattened;
}

// Test hook: renderFieldValue(value)
// - Normalisasi nilai field untuk ditampilkan (stringify, boolean, null handling).

function getReportFieldKeys(item: PathologyRecord) {
  const ordered = REPORT_FIELD_ORDER.filter((key) => key in item);
  const otherKeys = Object.keys(item).filter((key) => !ordered.includes(key));
  return [...ordered, ...otherKeys];
}

// Test hook: getReportFieldKeys(item)
// - Menghasilkan urutan kunci report yang akan dirender atau diedit.

function getReportText(item: PathologyRecord) {
  return getReportFieldKeys(item)
    .map((fieldKey) => `${formatFieldName(fieldKey)}: ${renderFieldValue(item[fieldKey])}`)
    .join('\n');
}

// Test hook: getReportText(item)
// - Mengembalikan teks lengkap report (plaintext) yang digunakan untuk share/email.

const ADMINISTRATION_FIELDS: string[] = [
  'nomor_pa',
  'kunjungan',
  'tanggal',
  'waktu',
  'id_simgos',
  'oleh',
  'asisten',
  'dokter',
  'status',
  'status_data',
  'status_pengiriman',
  'created_at',
];

const TYPE_FIELDS: string[] = [
  'jenis_pemeriksaan',
  'pa_sebelumnya',
  'jaringan',
  'lokasi',
  'topography',
  'morphology',
  'grade',
  'perilaku_tumor',
  'didapat_dengan',
  'cairan_fiksasi',
  'permintaan_ihc',
  'imuno_histokimia',
  'bukan_tumor',
  'reevolusi',
  'tanggal_imuno',
];

const RESULTS_FIELDS: string[] = [
  'diagnosa_klinik',
  'keterangan_klinik',
  'makroskopik',
  'mikroskopik',
  'kesimpulan',
];

const PATIENT_FIELDS: string[] = [
  'nama_pasien',
  'no_rm',
  'jenis_kelamin',
  'tgl_lahir',
  'umur',
  'alamat',
];

const PENGANTAR_PA_FIELDS: string[] = [
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

const PATHOLOGY_FIELDS: string[] = [
  'jenis_pemeriksaan',
  'topography',
  'morphology',
  'grade',
  'perilaku_tumor',
  'permintaan_ihc',
  'imuno_histokimia',
  'bukan_tumor',
  'reevolusi',
  'tanggal_imuno',
  'waktu',
  'status',
  'status_data',
  'status_pengiriman',
  'created_at',
  'user_id',
  ...RESULTS_FIELDS,
];

function buildSectionKeys(item: PathologyRecord, keys: string[]) {
  return keys.filter((key) => key in item && item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== '');
}

// Test hook: buildSectionKeys(item, keys)
// - Filter keys untuk section PDF/print yang memiliki nilai.

function drawPdfSection(
  doc: any,
  title: string,
  item: PathologyRecord,
  fieldKeys: string[],
  x: number,
  y: number,
  width: number,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  lineHeight: number,
) {
  const lines: string[] = [];
  const keys = buildSectionKeys(item, fieldKeys);
  if (!keys.length) return y;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(title, x, y);
  y += lineHeight;
  doc.setDrawColor(180);
  doc.setLineWidth(0.35);
  doc.line(x, y - 2, x + width, y - 2);
  y += 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const labelColumnWidth = Math.max(
    0,
    ...keys.map((key) => doc.getTextWidth(`${formatFieldName(key)}`)),
  ) + 4;
  const colonX = x + labelColumnWidth;
  const valueStartX = colonX + 1.5;
  const valueWidth = Math.max(10, width - (valueStartX - x));

  keys.forEach((key) => {
    const label = formatFieldName(key);
    const value = renderFieldValue(item[key]);
    const wrappedValue = doc.splitTextToSize(value, valueWidth);

    const lineCount = Math.max(1, wrappedValue.length);
    if (y + lineHeight * lineCount > pageHeight - margin - 40) {
      doc.addPage();
      y = margin;
    }

    doc.text(label, x, y);
    doc.text(':', colonX, y);
    doc.text(wrappedValue, valueStartX, y);
    y += lineHeight * lineCount;
    y += 1;
  });

  return y;
}

// Test hook: drawPdfSection(doc, title, item, fieldKeys, ...)
// - Menambahkan section ke dokumen jsPDF; gunakan untuk verifikasi layout/isi PDF.

function formatItemDate(item: PathologyRecord) {
  if (item.tanggal) {
    return `${item.tanggal}${item.waktu ? ` | ${item.waktu}` : ''}`;
  }
  if (item.created_at) {
    try {
      return format(new Date(item.created_at), 'dd MMM yyyy | HH:mm');
    } catch {
      return String(item.created_at);
    }
  }
  return item.id || '';
}

// Test hook: formatItemDate(item)
// - Format tanggal/waktu dari item untuk tampilan ringkas.
// Supports **bold** markers, list items starting with '- ', and preserves line breaks.
function renderSummaryHtml(src: string | undefined | null) {
  if (!src) return "";
  // escape HTML
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const raw = escapeHtml(src);
  const lines = raw.split(/\r?\n/);
  let out: string[] = [];
  let inList = false;

  // Helper to close list if open
  const closeListIfOpen = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (line === '') {
      // blank line -> close lists and add separator
      closeListIfOpen();
      out.push('<p></p>');
      continue;
    }

    // list item
    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      const item = line.substring(2).trim();
      const itemHtml = item.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      out.push(`<li>${itemHtml}</li>`);
      continue;
    }

    // bold-only header line like **Heading** or **Heading:**
    const mHeader = line.match(/^\*\*(.+?)\*\*:?$/);
    if (mHeader) {
      // close any open list first
      closeListIfOpen();
      const headingText = mHeader[1].trim();
      out.push(`<h2>${headingText}</h2>`);
      continue;
    }

    // fallback: inline bold formatting
    const inline = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // If this line looks like a subheading (ends with ':'), render as bold paragraph
    if (/^.+:$/.test(line)) {
      out.push(`<div><strong>${inline.replace(/:$/, '')}</strong></div>`);
    } else {
      out.push(`<div>${inline}</div>`);
    }
  }

  closeListIfOpen();
  return out.join('\n');
}

// Test hook: renderSummaryHtml(src)
// - Konversi markdown-lite ke HTML (bold, lists) untuk preview.

export default function DetailPage() {
  const router = useRouter();
  const params = useParams();
  const supabase = supabaseBrowser;
  const id = params.id as string;

  // auth/session
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [userRole, setUserRole] = useState<string>('');
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileStatus, setProfileStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // detail data
  const [detailData, setDetailData] = useState<PathologyRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Partial<PathologyRecord>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isAutoFillLoading, setIsAutoFillLoading] = useState(false);
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:5001';

  // share email modal
  const [showShareEmailModal, setShowShareEmailModal] = useState(false);
  const [shareEmailTo, setShareEmailTo] = useState("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [shareEmailStatus, setShareEmailStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [userName, setUserName] = useState<string>("");


  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        router.replace("/login");
        return;
      }
      setEmail(session.user.email || "");
      setMeta((session.user.user_metadata as UserMeta) || {});
      const role = ((session.user.user_metadata as any)?.role || '').toString().toLowerCase();
      setUserRole(role);
      setUserId(session.user.id);
      setUserName(
        (session.user.user_metadata as UserMeta)?.display_name ||
        (session.user.user_metadata as UserMeta)?.username ||
        session.user.email?.split("@")[0] ||
        "User"
      );
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  // Load detail data
  // fetch function that can be retried
  const fetchDetail = async () => {
    if (!id) {
      router.replace('/collections');
      return;
    }

    setFetching(true);
    setErrorText(null);
    setNotFound(false);
    setDetailData(null);

    try {
      const sessionResp = await supabase.auth.getSession();
      const accessToken = sessionResp?.data?.session?.access_token;
      if (accessToken) {
        const resp = await fetch(`${API_BASE}/api/hasil-patologi/me/${encodeURIComponent(id)}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const json = await resp.json().catch(() => null);
        if (resp.ok && json?.success && json.record) {
          setDetailData(flattenDetailRecord(json.record) as PathologyRecord);
          setNotFound(false);
          return;
        }
        console.warn('Backend detail endpoint failed:', resp.status, json);
      }

      const { data, error } = await supabase
        .from('hasil_patologi')
        .select(`
          *,
          pendaftaran_pa (
            id,
            no_kunjungan,
            nomor_pa,
            pa_sebelumnya,
            jaringan,
            lokasi,
            cairan_fiksasi,
            diagnosa_klinik,
            keterangan_klinik,
            asisten,
            didapat_dengan,
            dokter_perujuk,
            unit_pengantar,
            permintaan_ihc,
            master_pasien (
              no_rm,
              nama_pasien,
              jenis_kelamin,
              tgl_lahir,
              umur,
              alamat
            )
          )
        `)
        .eq('id', id)
        .limit(1);

      if (error) {
        console.error('Error fetching pathology record:', error);
        setErrorText(error.message || JSON.stringify(error, null, 2));
        setNotFound(true);
        return;
      }

          const record = Array.isArray(data) ? data[0] : data;
      if (!record) {
        setErrorText('No data returned');
        setNotFound(true);
        return;
      }

      setDetailData(flattenDetailRecord(record) as PathologyRecord);
      setNotFound(false);
    } catch (err: any) {
      console.error('Unexpected error loading detail:', err);
      setErrorText(err?.message ? String(err.message) : String(err));
      setNotFound(true);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    // wait for auth/session to be ready
    if (!loading) fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loading]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showProfileDropdown) {
        const target = event.target as Element;
        if (!target.closest(`.${s.avatar}`)) {
          setShowProfileDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProfileDropdown]);

  const onLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const toggleProfileDropdown = () => {
    setShowProfileDropdown(!showProfileDropdown);
  };

  const closeProfileDropdown = () => {
    setShowProfileDropdown(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Text copied to clipboard!");
  };

  const startEditing = () => {
    if (!detailData) return;
    const initial: Partial<PathologyRecord> = {};
    getReportFieldKeys(detailData)
      .filter((field) => isEditableField(field) && !FORBIDDEN_UPDATE_FIELDS.has(field.toLowerCase()))
      .forEach((field) => {
        const normalized = field.toLowerCase();
        if (
          HASIL_PATOLOGI_EDITABLE_FIELDS.has(normalized) ||
          PENDAFTARAN_PA_EDITABLE_FIELDS.has(normalized)
        ) {
          initial[field] = detailData[field];
        }
      });
    setEditValues(initial);
    setSaveStatus(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setSaveStatus(null);
  };

  const saveEdit = async () => {
    if (!detailData) return;
    setIsSaving(true);
    setSaveStatus(null);

    const { hasilPatologiUpdates, pendaftaranUpdates } = splitEditableUpdatePayload(detailData, editValues);

    if (Object.keys(hasilPatologiUpdates).length === 0 && Object.keys(pendaftaranUpdates).length === 0) {
      setSaveStatus({ type: 'error', message: 'Tidak ada data yang bisa disimpan.' });
      setIsSaving(false);
      return;
    }

    console.log('[saveEdit] payload debug', {
      hasilPatologiId: detailData.id,
      pendaftaranId: detailData.pendaftaran_id,
      hasilPatologiUpdates,
      pendaftaranUpdates,
    });

    try {
      let refreshedRecord = { ...detailData };

      if (Object.keys(hasilPatologiUpdates).length > 0) {
        const { data: hasilData, error: hasilError } = await supabase
          .from('hasil_patologi')
          .update(hasilPatologiUpdates)
          .eq('id', detailData.id)
          .select('*');

        if (hasilError) throw hasilError;

        const updatedResult = Array.isArray(hasilData) ? hasilData[0] : hasilData;
        if (updatedResult) {
          refreshedRecord = { ...refreshedRecord, ...updatedResult };
        } else {
          console.warn('[saveEdit] No row returned after updating hasil_patologi', { detailDataId: detailData.id, hasilPatologiUpdates });
        }
      }

      if (Object.keys(pendaftaranUpdates).length > 0) {
        if (!detailData.pendaftaran_id) {
          throw new Error('ID pendaftaran tidak tersedia untuk update data pengantar.');
        }

        const { data: pendaftaranData, error: pendaftaranError } = await supabase
          .from('pendaftaran_pa')
          .update(pendaftaranUpdates)
          .eq('id', detailData.pendaftaran_id)
          .select('*');

        if (pendaftaranError) throw pendaftaranError;

        const updatedPendaftaran = Array.isArray(pendaftaranData) ? pendaftaranData[0] : pendaftaranData;
        if (updatedPendaftaran) {
          refreshedRecord = { ...refreshedRecord, ...updatedPendaftaran, pendaftaran_id: detailData.pendaftaran_id };
        } else {
          console.warn('[saveEdit] No row returned after updating pendaftaran_pa', { pendaftaranId: detailData.pendaftaran_id, pendaftaranUpdates });
        }
      }

      setDetailData(refreshedRecord as PathologyRecord);
      setIsEditing(false);
      setSaveStatus({ type: 'success', message: 'Perubahan berhasil disimpan.' });
    } catch (err: any) {
      console.error('Save error:', err);
      setSaveStatus({ type: 'error', message: err?.message || 'Gagal menyimpan perubahan.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoFillPasien = async (noRm: string) => {
    const normalizedNoRm = String(noRm || '').trim();
    if (!normalizedNoRm) return;

    setIsAutoFillLoading(true);
    setSaveStatus(null);

    try {
      const response = await fetch(`${API_BASE}/api/pasien/${encodeURIComponent(normalizedNoRm)}`);
      const result = await response.json();

      if (response.ok && result.success && result.data) {
        const p = result.data;
        const autoFillValues: Partial<PathologyRecord> = {
          kunjungan: p.no_rm,
          cairan_fiksasi: p.cairan_fiksasi || (editValues.cairan_fiksasi ?? detailData?.cairan_fiksasi),
          keterangan_klinik: `Dokter Perujuk: ${p.dokter_perujuk || '-'}${p.unit_pengantar ? ` | Unit: ${p.unit_pengantar}` : ''}${p.umur ? ` | Umur: ${p.umur}` : ''}`,
        };

        setEditValues((prev) => ({ ...prev, ...autoFillValues }));
        setSaveStatus({ type: 'success', message: `Data pasien ${p.nama_pasien || normalizedNoRm} berhasil dimuat otomatis.` });
      } else {
        setSaveStatus({ type: 'error', message: result?.message || 'Data pasien tidak ditemukan di SIMRS.' });
      }
    } catch (error) {
      console.error('Gagal auto-fill pasien:', error);
      setSaveStatus({ type: 'error', message: 'Gagal memuat data pasien otomatis.' });
    } finally {
      setIsAutoFillLoading(false);
    }
  };

  useEffect(() => {
    const handleVoicePanelKunjungan = (event: Event) => {
      const customEvent = event as CustomEvent<{ no_rm: string }>;
      const voiceNoRm = String(customEvent.detail?.no_rm || "").trim();
      if (!voiceNoRm) return;
      handleAutoFillPasien(voiceNoRm);
    };

    window.addEventListener("voicepanel-kunjungan-click", handleVoicePanelKunjungan as EventListener);
    return () => {
      window.removeEventListener("voicepanel-kunjungan-click", handleVoicePanelKunjungan as EventListener);
    };
  }, [detailData, editValues]);

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this transcription?")) return;

    (async () => {
      try {
        const userRes = await supabase.auth.getUser();
        const userId = userRes?.data?.user?.id;
        if (!userId) {
          alert('Anda belum login.');
          return;
        }
        const { data: deleted, error } = await supabase
          .from('hasil_patologi')
          .delete()
          .eq('id', id)
          .eq('user_id', userId)
          .select('id');

        if (error) {
          alert('Gagal menghapus: ' + error.message);
          console.error('Delete error:', error);
          return;
        }

        if (!deleted || (Array.isArray(deleted) && deleted.length === 0)) {
          alert('Gagal menghapus: baris tidak ditemukan atau akses ditolak (RLS).');
          return;
        }

        // success -> navigate back to collections
        router.push('/collections');
      } catch (err) {
        console.error('Unexpected delete error', err);
        alert('Gagal menghapus item.');
      }
    })();
  };

  const getMailtoUrl = (item: PathologyRecord) => {
    const subject = item.nomor_pa ? `Hasil Patologi PA ${item.nomor_pa}` : 'Hasil Patologi';
    const body = getReportText(item);
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // NOTE: "Kirim ke API" flow removed — use centralized upload workflow instead.

  const handleShareEmail = () => {
    if (!detailData) return;
    setShareEmailTo("");
    setShareEmailStatus(null);
    setShowShareEmailModal(true);
  };

  const closeShareEmailModal = () => {
    setShowShareEmailModal(false);
    setShareEmailStatus(null);
  };

  const handleSendEmail = async () => {
    if (!detailData) return;
    
    if (!shareEmailTo.trim()) {
      setShareEmailStatus({ type: "error", message: "Email tujuan tidak boleh kosong" });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareEmailTo.trim())) {
      setShareEmailStatus({ type: "error", message: "Format email tidak valid" });
      return;
    }

    setIsSendingEmail(true);
    setShareEmailStatus(null);

    try {
      const subject = detailData.nomor_pa ? `Hasil Patologi PA ${detailData.nomor_pa}` : 'Hasil Patologi';
      const body = getReportText(detailData);
      
      const backendUrl = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:5001';
      const apiUrl = `${backendUrl}/api/send-email`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to_email: shareEmailTo.trim(),
          subject: subject,
          body: body,
          is_html: false,
          hasil_patologi_id: detailData.id,
          petugas_id: userId,
          nama_petugas: userName,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setShareEmailStatus({ type: "success", message: "Email berhasil dikirim!" });
        setTimeout(() => {
          closeShareEmailModal();
        }, 2000);
      } else {
        setShareEmailStatus({ type: "error", message: data.message || "Gagal mengirim email" });
      }
    } catch (error) {
      console.error("Error sending email:", error);
      setShareEmailStatus({ type: "error", message: "Terjadi kesalahan saat mengirim email" });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const getReportHtml = (item: PathologyRecord) => {
    const title = item.nomor_pa ? `Hasil Patologi PA ${item.nomor_pa}` : 'Hasil Patologi';
    const rows = getReportFieldKeys(item)
      .map((fieldKey) => `<div><strong>${formatFieldName(fieldKey)}</strong>: ${String(renderFieldValue(item[fieldKey]))}</div>`)
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${rows}</body></html>`;
  };

  const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number } | null> => {
    return new Promise((resolve) => {
      const img = new (globalThis as any).Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        resolve(null);
      };
      img.src = dataUrl;
    });
  };

  const calculateSignatureImageDimensions = (
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number,
  ): { width: number; height: number } => {
    const aspectRatio = originalWidth / originalHeight;
    let width = maxWidth;
    let height = maxWidth / aspectRatio;

    if (height > maxHeight) {
      height = maxHeight;
      width = maxHeight * aspectRatio;
    }

    return { width, height };
  };

  const loadImageDataUrl = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          resolve(typeof result === 'string' ? result : null);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error loading signature image:', error);
      return null;
    }
  };

  const fetchUserMetaById = async (userId: string): Promise<UserMeta | null> => {
    if (!userId) return null;
    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:5001';
      const response = await fetch(`${backendUrl}/api/user-meta/${encodeURIComponent(userId)}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data?.user_metadata || data?.raw_user_meta_data || null;
    } catch (error) {
      console.error('Error fetching user metadata:', error);
      return null;
    }
  };

  const handleExportPdf = async () => {
    if (!detailData) return;

    // Refresh metadata before export, so updated signature_url is used
    let currentUserMeta: UserMeta = {};
    let currentUserId = '';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      currentUserId = user?.id || '';
      currentUserMeta = (user?.user_metadata as UserMeta) || {};
      setMeta(currentUserMeta);
    } catch {
      // ignore refresh errors
    }

    let doctorMeta: UserMeta | null = null;
    if (detailData.user_id && detailData.user_id !== currentUserId) {
      doctorMeta = await fetchUserMetaById(detailData.user_id);
    }
    if (!doctorMeta) {
      doctorMeta = currentUserMeta;
    }

    const petugasMeta = currentUserId && currentUserId !== detailData.user_id ? currentUserMeta : null;

    const jsPDFModule = (await import('jspdf')) as any;
    const { jsPDF } = jsPDFModule;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const lineHeight = 6.2;

    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    const title = 'Hasil Pemeriksaan Hispatologi';
    doc.text(title, pageWidth / 2, margin + 10, { align: 'center' });

    // Content
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    let cursorY = margin + 24;
    const contentWidth = pageWidth - margin * 2;
    const sectionGap = 6;
    const columnWidth = (contentWidth - sectionGap) / 2;

    const leftEndY = drawPdfSection(
      doc,
      'Administrasi',
      detailData,
      ADMINISTRATION_FIELDS,
      margin,
      cursorY,
      columnWidth,
      pageWidth,
      pageHeight,
      margin,
      lineHeight,
    );
    const rightEndY = drawPdfSection(
      doc,
      'Pemeriksaan',
      detailData,
      TYPE_FIELDS,
      margin + columnWidth + sectionGap,
      cursorY,
      columnWidth,
      pageWidth,
      pageHeight,
      margin,
      lineHeight,
    );

    cursorY = Math.max(leftEndY, rightEndY) + 7;
    if (cursorY > pageHeight - margin - 70) {
      doc.addPage();
      cursorY = margin;
    }

    cursorY = drawPdfSection(
      doc,
      'Hasil',
      detailData,
      RESULTS_FIELDS,
      margin,
      cursorY,
      contentWidth,
      pageWidth,
      pageHeight,
      margin,
      lineHeight,
    );

    // Signature section
    const leftX = margin + 50;
    const rightX = pageWidth - margin - 50;
    const signatureLabelY = pageHeight - 84;
    const signatureImageY = pageHeight - 80;
    const signatureLineY = pageHeight - 46;
    const signatureNameY = pageHeight - 24;
    const maxSignatureWidth = 80;
    const maxSignatureHeight = 45;
    const defaultSignatureAspectRatio = 3.5; // typical signature is wider than tall
    const role = ((meta.role || 'dokter') as string).toLowerCase() === 'petugas' ? 'petugas' : 'dokter';

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Asisten Patologi Anatomi', leftX, signatureLabelY, { align: 'center' });
    doc.text('Ahli Patologi Anatomi', rightX, signatureLabelY, { align: 'center' });
    doc.setLineWidth(0.5);

    const doctorSignatureUrl = doctorMeta?.signature_url;
    const doctorSignatureDataUrl = doctorSignatureUrl ? await loadImageDataUrl(doctorSignatureUrl) : null;
    const doctorName = doctorMeta?.display_name || doctorMeta?.username || 'Ahli Patologi';

    const petugasSignatureUrl = petugasMeta?.signature_url;
    const petugasSignatureDataUrl = petugasSignatureUrl ? await loadImageDataUrl(petugasSignatureUrl) : null;
    const petugasName = petugasMeta?.display_name || petugasMeta?.username || 'Asisten Patologi';

    // Helper function to add signature image with aspect ratio preservation
    const addSignatureImageToPdf = async (
      imageDataUrl: string | null,
      xPos: number,
      yPos: number,
      fallbackLineStartX: number,
      fallbackLineEndX: number,
      fallbackLineY: number,
    ) => {
      if (imageDataUrl) {
        try {
          // Try to get actual dimensions
          const dimensions = await getImageDimensions(imageDataUrl);
          let width = maxSignatureWidth;
          let height = maxSignatureHeight;
          
          if (dimensions && dimensions.width && dimensions.height) {
            // Calculate based on actual aspect ratio
            const aspectRatio = dimensions.width / dimensions.height;
            width = maxSignatureWidth;
            height = maxSignatureWidth / aspectRatio;
            
            if (height > maxSignatureHeight) {
              height = maxSignatureHeight;
              width = maxSignatureHeight * aspectRatio;
            }
          } else {
            // Use default aspect ratio if dimensions can't be determined
            height = maxSignatureHeight;
            width = maxSignatureHeight * defaultSignatureAspectRatio;
            if (width > maxSignatureWidth) {
              width = maxSignatureWidth;
              height = maxSignatureWidth / defaultSignatureAspectRatio;
            }
          }
          
          doc.addImage(
            imageDataUrl,
            'PNG',
            xPos - width / 2,
            yPos,
            width,
            height,
          );
          doc.line(xPos - width / 2, yPos + height + 1, xPos + width / 2, yPos + height + 1);
        } catch (error) {
          console.error('Error adding signature image:', error);
          doc.line(fallbackLineStartX, fallbackLineY, fallbackLineEndX, fallbackLineY);
        }
      } else {
        doc.line(fallbackLineStartX, fallbackLineY, fallbackLineEndX, fallbackLineY);
      }
    };

    if (petugasMeta) {
      await addSignatureImageToPdf(
        petugasSignatureDataUrl,
        leftX,
        signatureImageY,
        leftX - 40,
        leftX + 40,
        signatureLineY,
      );
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(petugasName, leftX, signatureNameY, { align: 'center' });

      await addSignatureImageToPdf(
        doctorSignatureDataUrl,
        rightX,
        signatureImageY,
        rightX - 40,
        rightX + 40,
        signatureLineY,
      );
      doc.text(doctorName, rightX, signatureNameY, { align: 'center' });
    } else {
      doc.line(leftX - 40, signatureLineY, leftX + 40, signatureLineY);
      await addSignatureImageToPdf(
        doctorSignatureDataUrl,
        rightX,
        signatureImageY,
        rightX - 40,
        rightX + 40,
        signatureLineY,
      );
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text(doctorName, rightX, signatureNameY, { align: 'center' });
    }

    const finalPdfName = (pdfFileName && pdfFileName.trim()) ? pdfFileName.trim() : `transcription-${detailData.id}.pdf`;
    doc.save(finalPdfName);

    // Log history_pengiriman entry for petugas role when exporting PDF
    try {
      if ((userRole || '').toString().toLowerCase() === 'petugas') {
        await supabase.from('history_pengiriman').insert({
          hasil_patologi_id: detailData.id,
          petugas_id: userId || null,
          nama_petugas: userName || null,
          metode_pengiriman: 'export_pdf',
          tujuan_pengiriman: finalPdfName,
          status: 'success',
        });
      }
    } catch (err) {
      console.warn('Failed to log history_pengiriman for export_pdf:', err);
    }
  };

  const handleExport = () => {
    if (detailData) {
      const content = getReportText(detailData);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcription-${detailData.id}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const username = meta.username || email.split("@")[0] || "User";
  const avatar = meta.avatar_url || "https://i.pravatar.cc/64?img=12";

  const openProfileModal = () => {
    setProfileName(meta.display_name || meta.username || email.split("@")[0] || "");
    setProfileEmail(email);
    setProfileStatus(null);
    setShowProfileDropdown(false);
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setProfileStatus(null);
  };

  const saveProfile = async () => {
    setProfileStatus(null);
    if (!profileName.trim()) {
      setProfileStatus({ type: "error", message: "Nama tidak boleh kosong." });
      return;
    }
    if (!profileEmail.trim()) {
      setProfileStatus({ type: "error", message: "Email tidak boleh kosong." });
      return;
    }

    setIsSavingProfile(true);
    const { data: { user }, error } = await supabase.auth.updateUser({
      email: profileEmail,
      data: {
        display_name: profileName,
        username: profileName,
      },
    });

    if (error) {
      setProfileStatus({ type: "error", message: error.message });
      setIsSavingProfile(false);
      return;
    }

    const userMeta = (user?.user_metadata as UserMeta) || {};
    setMeta(userMeta);
    setEmail(user?.email || profileEmail);
    setProfileStatus({ type: "success", message: "Profil berhasil disimpan." });
    setIsSavingProfile(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showProfileDropdown) {
        const target = event.target as Element;
        if (!target.closest(`.${s.avatar}`)) {
          setShowProfileDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProfileDropdown]);

  if (loading) {
    return (
      <>
        <main className={s.content}>
          <div className={s.card}>Loading...</div>
        </main>
      </>
    );
  }

  if (!detailData) {
    if (notFound) {
      return (
        <>
          <main className={s.content}>
            <div className={s.card}>
              <h3>Data tidak ditemukan</h3>
              <p>Data hasil patologi yang diminta tidak ditemukan. Mungkin sudah dihapus atau ID tidak valid.</p>
              <p style={{ fontSize: 12, color: '#666' }}>Requested id: <strong>{id}</strong></p>
              {errorText && (
                <div style={{ marginTop: 8, color: '#b00' }}>
                  <strong>Error:</strong> {errorText}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className={d.actionButton} onClick={() => router.push('/collections')}>Kembali ke Collections</button>
                <button className={d.actionButton} onClick={() => fetchDetail()} disabled={fetching}>
                  {fetching ? 'Retrying...' : 'Retry'}
                </button>
              </div>
            </div>
          </main>
        </>
      );
    }

    return (
      <>
        <main className={s.content}>
          <div className={s.card}>Loading transcription...</div>
        </main>
      </>
    );
  }

  return (
    <>
      {/* SIDEBAR REMOVED - Now in LayoutClient */}
      <aside style={{ display: 'none' }}></aside>

      {/* TOPBAR REMOVED - Now in LayoutClient */}
      <header style={{ display: 'none' }}></header>

      {/* CONTENT */}
      <main className={s.content}>
        <div className={d.detailContainer}>
          <div className={d.detailHeader}>
            <div className={d.headerInfo}>
              <h1 className={d.detailTitle}>
                {detailData.nomor_pa ? `PA ${detailData.nomor_pa}` : 'Detail Hasil Patologi'}
              </h1>
              <div className={d.detailMeta}>
                <div className={d.metaItem}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  {formatItemDate(detailData)}
                </div>
                <div className={d.metaItem}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 4h18"></path>
                    <path d="M5 10h14"></path>
                    <path d="M7 16h10"></path>
                  </svg>
                  {detailData.jaringan ? `${detailData.jaringan}${detailData.lokasi ? ` • ${detailData.lokasi}` : ''}` : detailData.lokasi || '-'}
                </div>
              </div>
            </div>

            <div className={d.headerActions}>
              <button className={d.actionButton} onClick={() => router.push('/collections')} title="Kembali" aria-label="Kembali" type="button">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6"></path>
                </svg>
              </button>
              {userRole !== 'superadmin' && (
                !isEditing ? (
                  <button className={d.actionButton} onClick={startEditing} title="Edit" aria-label="Edit" type="button">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h16"></path>
                      <path d="M18.5 5.5a2.121 2.121 0 0 1 3 3L9 21l-4 1 1-4L18.5 5.5Z"></path>
                    </svg>
                  </button>
                ) : (
                  <>
                    <button className={d.actionButton} onClick={saveEdit} disabled={isSaving}>
                      {isSaving ? 'Menyimpan...' : 'Simpan'}
                    </button>
                    <button className={d.secondaryButton} onClick={cancelEditing} disabled={isSaving}>
                      Batal
                    </button>
                  </>
                )
              )}
              {userRole === 'petugas' && (
                <button className={d.actionButton} onClick={handleShareEmail} title="Share Email" aria-label="Share Email" type="button">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16v10H4z"></path>
                  <path d="M4 7l8 6 8-6"></path>
                </svg>
                </button>
              )}
              {userRole === 'petugas' && (
                <button
                  className={d.actionButton}
                  onClick={async () => await handleExportPdf()}
                  type="button"
                  title="Export PDF"
                  aria-label="Export PDF"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12"></path>
                    <path d="M8 13l4 4 4-4"></path>
                    <path d="M6 21h12"></path>
                  </svg>
                </button>
              )}
              {/* "Kirim ke API" removed */}
            </div>
          </div>

          {saveStatus && (
            <div className={saveStatus.type === 'success' ? d.saveSuccess : d.saveError} style={{ marginBottom: 16 }}>
              {saveStatus.message}
            </div>
          )}

          <div className={d.detailContent}>
            <div className={d.detailSections}>
              <div className={d.detailSection}>
                <h2 className={d.sectionTitle}>Informasi Pasien</h2>
                <div className={d.detailFieldList}>
                  {PATIENT_FIELDS.map((fieldKey) => (
                    <div key={fieldKey} className={d.detailFieldRow}>
                      <div className={d.detailFieldLabel}>{formatFieldName(fieldKey)}</div>
                      <div className={d.detailFieldValue}>{renderFieldValue(detailData[fieldKey])}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={d.detailSection}>
                <h2 className={d.sectionTitle}>Data Pengantar PA</h2>
                <div className={d.detailFieldList}>
                  {PENGANTAR_PA_FIELDS.map((fieldKey) => (
                    <div key={fieldKey} className={d.detailFieldRow}>
                      <div className={d.detailFieldLabel}>{formatFieldName(fieldKey)}</div>
                      <div className={d.detailFieldValue}>{renderFieldValue(detailData[fieldKey])}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className={d.detailSection}>
              <h2 className={d.sectionTitle}>Hasil Patologi</h2>
              <div className={d.detailFieldList}>
                {PATHOLOGY_FIELDS.map((fieldKey) => {
                  if (!Object.prototype.hasOwnProperty.call(detailData, fieldKey)) return null;

                  const shouldHideIhcFields = ['imuno_histokimia', 'permintaan_ihc', 'tanggal_imuno'].includes(fieldKey) && !shouldShowIhcField(fieldKey, detailData);
                  if (shouldHideIhcFields) {
                    return null;
                  }

                  const isTextareaField = ['kesimpulan', 'makroskopik', 'mikroskopik', 'keterangan_klinik', 'diagnosa_klinik', 'didapat_dengan', 'cairan_fiksasi', 'imuno_histokimia'].includes(fieldKey);
                  const isGradeField = fieldKey === 'grade';
                  const isPerilakuTumorField = fieldKey === 'perilaku_tumor';
                  const isTopographyField = fieldKey === 'topography';
                  const isMorphologyField = fieldKey === 'morphology';

                  return (
                    <div key={fieldKey} className={d.detailFieldRow}>
                      <div className={d.detailFieldLabel}>{formatFieldName(fieldKey)}</div>
                      {isEditing && isEditableField(fieldKey) ? (
                        isTextareaField ? (
                          <textarea
                            className={d.editTextarea}
                            value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                            rows={3}
                          />
                        ) : isGradeField ? (
                          <select
                            className={d.editInput}
                            value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value === '' ? '' : Number(e.target.value) }))}
                          >
                            <option value="">Pilih grade</option>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                          </select>
                        ) : isPerilakuTumorField ? (
                          <select
                            className={d.editInput}
                            value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value === '' ? '' : Number(e.target.value) }))}
                          >
                            <option value="">Pilih perilaku tumor</option>
                            <option value="1">1 - Jinak</option>
                            <option value="2">2 - Borderline</option>
                            <option value="3">3 - Ganas</option>
                          </select>
                        ) : isTopographyField ? (
                          <>
                            <input
                              className={d.editInput}
                              type="text"
                              list="icdo-topography-options"
                              value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                              placeholder="Contoh: C50.9"
                              autoComplete="off"
                            />
                            <datalist id="icdo-topography-options">
                              {ICDO_TOPOGRAPHY_OPTIONS.map((option) => (
                                <option key={option} value={option} />
                              ))}
                            </datalist>
                          </>
                        ) : isMorphologyField ? (
                          <>
                            <input
                              className={d.editInput}
                              type="text"
                              list="icdo-morphology-options"
                              value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                              placeholder="Contoh: M8000/3"
                              autoComplete="off"
                            />
                            <datalist id="icdo-morphology-options">
                              {ICDO_MORPHOLOGY_OPTIONS.map((option) => (
                                <option key={option} value={option} />
                              ))}
                            </datalist>
                          </>
                        ) : fieldKey === 'permintaan_ihc' ? (
                          <input
                            className={d.editInput}
                            type="text"
                            value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                            placeholder="Contoh: ER, PR, HER2"
                          />
                        ) : (
                          <input
                            className={d.editInput}
                            type="text"
                            value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                            onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                          />
                        )
                      ) : (
                        <div className={d.detailFieldValue}>{renderFieldValue(detailData[fieldKey])}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={d.footerActions}>
            {userRole !== 'superadmin' && (
              <button className={d.dangerButton} onClick={handleDelete}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3,6 5,6 21,6"></polyline>
                  <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                Delete
              </button>
            )}
          </div>
        </div>
      

      {/* Profile Modal */}
      {showProfileModal && (
        <div className={s.profileModalOverlay} onClick={closeProfileModal}>
          <div className={s.profileModal} onClick={(event) => event.stopPropagation()}>
            <div className={s.profileModalHeader}>
              <div>
                <h2>Edit Profil</h2>
                <p className={s.profileModalNotice}>Nama dan email diambil dari akun Supabase Anda.</p>
              </div>
              <button className={s.modalClose} onClick={closeProfileModal} aria-label="Tutup">×</button>
            </div>

            <div className={s.profileModalBody}>
              <label className={s.formRow}>
                <span>Nama</span>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Nama tampil"
                />
              </label>
              <label className={s.formRow}>
                <span>Email</span>
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  placeholder="Email"
                />
              </label>
            </div>

            {profileStatus && (
              <div className={profileStatus.type === "error" ? s.profileError : s.profileSuccess}>
                {profileStatus.message}
              </div>
            )}

            <div className={s.profileModalFooter}>
              <button className={s.buttonSecondary} onClick={closeProfileModal} type="button">
                Batal
              </button>
              <button className={s.buttonPrimary} onClick={saveProfile} type="button" disabled={isSavingProfile}>
                {isSavingProfile ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARE EMAIL MODAL */}
      {showShareEmailModal && detailData && (
        <div className={s.profileModalOverlay} onClick={closeShareEmailModal}>
          <div className={s.profileModal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1400px', width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className={s.profileModalHeader}>
              <div>
                <h2>Kirim Email Hasil Patologi</h2>
                <p className={s.profileModalNotice}>Preview isi email sebelum mengirim</p>
              </div>
              <button className={s.modalClose} onClick={closeShareEmailModal} aria-label="Tutup">×</button>
            </div>

            <div className={s.profileModalBody} style={{ display: 'flex', gap: '20px', flex: 1, overflowY: 'auto' }}>
              {/* Preview Section - Left side */}
              <div style={{ 
                flex: 1,
                background: '#f5f5f5', 
                border: '1px solid #e0e0e0', 
                borderRadius: '8px', 
                padding: '16px',
                minWidth: '0',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#333' }}>📧 Preview Email</h3>
                
                <div style={{ background: 'white', border: '1px solid #ddd', borderRadius: '6px', padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong style={{ fontSize: '12px', color: '#666' }}>Subject:</strong>
                    <div style={{ fontSize: '14px', color: '#333', marginTop: '4px', wordBreak: 'break-word' }}>
                      {detailData.nomor_pa ? `Hasil Patologi PA ${detailData.nomor_pa}` : 'Hasil Patologi'}
                    </div>
                  </div>
                  
                  <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #eee' }} />
                  
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                    <strong style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Body:</strong>
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#555', 
                      background: '#fafafa',
                      padding: '10px',
                      borderRadius: '4px',
                      flex: 1,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'monospace',
                      lineHeight: '1.4'
                    }}>
                      {getReportText(detailData)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Input Section - Right side */}
              <div style={{ 
                width: '300px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {/* Email Input */}
                <div>
                  <label style={{ fontWeight: 600, marginBottom: '8px', display: 'block', fontSize: '14px' }}>Kirim ke Email:</label>
                  <input
                    type="email"
                    value={shareEmailTo}
                    onChange={(e) => setShareEmailTo(e.target.value)}
                    placeholder="example@email.com"
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {/* Status Messages */}
                {shareEmailStatus && (
                  <div style={{
                    padding: '12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    background: shareEmailStatus.type === "error" ? '#ffebee' : '#e8f5e9',
                    color: shareEmailStatus.type === "error" ? '#c62828' : '#2e7d32',
                    border: `1px solid ${shareEmailStatus.type === "error" ? '#ef5350' : '#66bb6a'}`,
                    wordBreak: 'break-word'
                  }}>
                    {shareEmailStatus.message}
                  </div>
                )}

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  <button 
                    className={s.buttonSecondary} 
                    onClick={closeShareEmailModal} 
                    type="button"
                    style={{ flex: 1 }}
                  >
                    Batal
                  </button>
                  <button 
                    className={s.buttonPrimary} 
                    onClick={handleSendEmail} 
                    type="button" 
                    disabled={isSendingEmail || !shareEmailTo.trim()}
                    style={{ flex: 1 }}
                  >
                    {isSendingEmail ? "Mengirim..." : "Kirim Email"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </main>
    </>
  );
}
