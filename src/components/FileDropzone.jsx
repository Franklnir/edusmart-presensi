import React from 'react';
import { useDropzone } from 'react-dropzone';

// Helper function to clean and validate accept string for DISPLAY
const cleanAcceptString = (accept) => {
  if (!accept) return undefined;

  // FIX: Jika accept adalah Object (Format React Dropzone v14+), 
  // kita ekstrak ekstensinya untuk ditampilkan sebagai teks
  // Contoh: { 'image/*': ['.png', '.jpg'] } menjadi ".png, .jpg"
  if (typeof accept === 'object' && !Array.isArray(accept)) {
    return Object.values(accept).flat().join(', ');
  }
  
  // FIX: Pastikan accept adalah string sebelum melakukan .split
  if (typeof accept !== 'string') return undefined;

  // Logic lama untuk membersihkan string
  const cleaned = accept
    .split(',')
    .map(item => item.trim())
    .filter(item => {
      const mimePattern = /^[a-z]+\/\*|^[a-z]+\/[a-z0-9\.\+-]+$/i;
      const extensionPattern = /^\.[a-z0-9]+$/i;
      return mimePattern.test(item) || extensionPattern.test(item);
    })
    .join(', ');
  
  return cleaned || undefined;
};

const FileDropzone = ({ onFiles, onFileSelected, accept, maxSize, multiple = false, label = 'Drop file di sini', disabled = false, className = '' }) => {
  
  // String untuk ditampilkan di UI (teks "Format: ...")
  const displayAccept = cleanAcceptString(accept);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    // FIX: Jika accept object, kirim langsung. Jika string, kirim hasil cleaning.
    accept: typeof accept === 'object' ? accept : displayAccept, 
    multiple,
    maxSize,
    disabled, // Tambahkan support props disabled
    onDrop: (acceptedFiles) => {
      if (acceptedFiles && acceptedFiles.length > 0) {
        if (onFiles && typeof onFiles === 'function') {
          onFiles(acceptedFiles);
        } else if (onFileSelected && typeof onFileSelected === 'function') {
          onFileSelected(acceptedFiles[0]);
        } else {
          console.error('No valid file handler provided');
        }
      }
    }
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
        disabled 
          ? 'bg-gray-100 border-gray-300 cursor-not-allowed opacity-60' 
          : isDragActive 
            ? 'border-blue-400 bg-blue-50 cursor-pointer' 
            : 'border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer'
      } ${className}`}
    >
      <input {...getInputProps()} />
      <div className="space-y-2">
        <div className="text-3xl">📁</div>
        <p className="text-sm text-slate-600 font-medium">
          {isDragActive ? 'Lepaskan file di sini' : label}
        </p>
        
        {!disabled && (
          <p className="text-xs text-slate-500">
            atau klik untuk memilih file
          </p>
        )}

        {/* Tampilkan format file yang diizinkan */}
        {displayAccept && (
          <p className="text-xs text-slate-400 mt-1 truncate max-w-xs mx-auto">
            Format: {displayAccept}
          </p>
        )}
        
        {maxSize && (
          <p className="text-xs text-slate-400 mt-1">
            Maksimal: {(maxSize / (1024 * 1024)).toFixed(0)}MB
          </p>
        )}
      </div>
    </div>
  );
};

export default FileDropzone;