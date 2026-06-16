<x-mail::message>
# Halo, {{ $studentName }}!

Selamat! Anda telah mendapatkan **Sertifikat Baru** untuk partisipasi/prestasi Anda dalam:
**{{ $certificate->event }}**

Kami dari **{{ $schoolName }}** sangat bangga dengan pencapaian Anda.
Silakan unduh atau lihat sertifikat Anda melalui tombol di bawah ini.

<x-mail::button :url="$downloadUrl" color="success">
Unduh Sertifikat
</x-mail::button>

Terus tingkatkan prestasi dan semangat belajar Anda!

Salam Hangat,<br>
**Tim {{ $schoolName }}**
</x-mail::message>
