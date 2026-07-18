"use client";

import s from "@/app/styles/dashboard.module.css";

type ProfileStatus = { type: "success" | "error"; message: string } | null;

type ProfileModalProps = {
  open: boolean;
  profileName: string;
  profileEmail: string;
  roleLabel: string;
  profileStatus: ProfileStatus;
  isSaving: boolean;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
};

export default function ProfileModal({
  open,
  profileName,
  profileEmail,
  roleLabel,
  profileStatus,
  isSaving,
  onClose,
  onNameChange,
  onSave,
}: ProfileModalProps) {
  if (!open) return null;

  return (
    <div className={s.profileModalOverlay} onClick={onClose}>
      <div className={s.profileModal} onClick={(event) => event.stopPropagation()}>
        <div className={s.profileModalHeader}>
          <div>
            <h2>Edit Profil</h2>
            <p className={s.profileModalNotice}>Nama dan email diambil dari akun Supabase Anda.</p>
          </div>
          <button className={s.modalClose} onClick={onClose} aria-label="Tutup">×</button>
        </div>

        <div className={s.profileModalBody}>
          <label className={s.formRow}>
            <span>Nama</span>
            <input
              type="text"
              value={profileName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Nama tampil"
            />
          </label>
          <label className={s.formRow}>
            <span>Email</span>
            <input type="email" value={profileEmail} readOnly disabled />
          </label>
          <label className={s.formRow}>
            <span>Role</span>
            <input type="text" value={roleLabel} readOnly disabled />
          </label>
        </div>

        {profileStatus && (
          <div className={profileStatus.type === "error" ? s.profileError : s.profileSuccess}>
            {profileStatus.message}
          </div>
        )}

        <div className={s.profileModalFooter}>
          <button className={s.buttonSecondary} onClick={onClose} type="button">
            Batal
          </button>
          <button className={s.buttonPrimary} onClick={onSave} type="button" disabled={isSaving}>
            {isSaving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
