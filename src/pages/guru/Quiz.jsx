import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/useAuthStore'
import { useUIStore } from '../../store/useUIStore'
import { formatDateTime } from '../../lib/time'

const POINT_OPTIONS = [1, 2, 5, 10, 20, 25]

const makeId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const normalizeMapel = (v) => (v || '').toString().trim()

const safeDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

const toMinuteDate = (value) => {
  const d = safeDate(value)
  if (!d) return null
  d.setSeconds(0, 0)
  return d
}

const getNowLocalInput = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16)
}

const toLocalInput = (value) => {
  const d = safeDate(value)
  if (!d) return ''
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16)
}

const formatRemaining = (seconds) => {
  if (seconds == null) return '-'
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const parts = []
  if (h > 0) parts.push(String(h).padStart(2, '0'))
  parts.push(String(m).padStart(2, '0'))
  parts.push(String(r).padStart(2, '0'))
  return parts.join(':')
}

const formatDurationText = (startedAtValue, endedAtValue = new Date()) => {
  const startedAt = safeDate(startedAtValue)
  const endedAt = safeDate(endedAtValue) || new Date()
  if (!startedAt || !endedAt || endedAt < startedAt) return '-'

  const diffSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
  if (diffSeconds < 60) return '< 1 menit'

  const totalMinutes = Math.floor(diffSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours} jam ${minutes} menit`
  if (hours > 0) return `${hours} jam`
  return `${totalMinutes} menit`
}

const normalizeMode = (quiz) => {
  const raw = (quiz?.mode || '').toString().toLowerCase()
  if (raw === 'regular') return 'regular'
  if (raw === 'uts') return 'uts'
  if (raw === 'uas') return 'uas'
  if (raw === 'ulangan') return 'uts'
  return quiz?.is_live ? 'uts' : 'regular'
}

const getModeLabel = (quiz) => {
  const mode = normalizeMode(quiz)
  if (mode === 'uts') return 'Mode UTS'
  if (mode === 'uas') return 'Mode UAS'
  return 'Mode Reguler'
}

const getQuizEndAt = (quiz) => {
  const mode = normalizeMode(quiz)
  if (mode === 'regular') return safeDate(quiz?.deadline_at)
  const startsAt = safeDate(quiz?.live_started_at || quiz?.starts_at)
  const duration = Number(quiz?.duration_minutes || 0)
  if (!startsAt || duration <= 0) return safeDate(quiz?.deadline_at)
  return new Date(startsAt.getTime() + duration * 60000)
}

const getRemainingSeconds = (quiz, now) => {
  const endAt = getQuizEndAt(quiz)
  if (!endAt) return null
  return Math.floor((endAt.getTime() - now.getTime()) / 1000)
}

const getQuizStatus = (quiz, now = new Date()) => {
  const startsAt = safeDate(quiz?.starts_at)
  const endAt = getQuizEndAt(quiz)

  if (!startsAt) {
    return { label: 'Belum dijadwalkan', tone: 'bg-yellow-100 text-yellow-700 border-yellow-200', kind: 'draft' }
  }

  if (endAt && now > endAt) {
    return { label: 'Berakhir', tone: 'bg-red-100 text-red-700 border-red-200', kind: 'expired' }
  }

  if (now < startsAt) {
    return { label: 'Belum dimulai', tone: 'bg-yellow-100 text-yellow-700 border-yellow-200', kind: 'scheduled' }
  }

  return { label: 'Sedang berlangsung', tone: 'bg-green-100 text-green-700 border-green-200', kind: 'active' }
}

export default function GuruQuiz() {
  const { user } = useAuthStore()
  const { pushToast, setLoading } = useUIStore()

  const [jadwal, setJadwal] = useState([])
  const [kelasList, setKelasList] = useState([])
  const [selectedKelas, setSelectedKelas] = useState('')
  const [mapelList, setMapelList] = useState([])
  const [selectedMapel, setSelectedMapel] = useState('')

  const [quizList, setQuizList] = useState([])
  const [quizStatsById, setQuizStatsById] = useState({})
  const [selectedQuizId, setSelectedQuizId] = useState('')
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [participants, setParticipants] = useState([])
  const [retakeLogs, setRetakeLogs] = useState([])
  const [nowTick, setNowTick] = useState(() => new Date())

  const [showQuizForm, setShowQuizForm] = useState(false)
  const [quizForm, setQuizForm] = useState({
    nama: '',
    penilaian: 'poin',
    mode: 'regular'
  })
  const [scheduleForm, setScheduleForm] = useState({
    starts_at: '',
    deadline_at: '',
    duration_minutes: 60
  })

  const [showQuestionForm, setShowQuestionForm] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [questionForm, setQuestionForm] = useState({
    soal: '',
    poin: 10,
    options: { A: '', B: '', C: '', D: '' },
    correct: 'A'
  })

  const selectedQuiz = quizList.find((q) => q.id === selectedQuizId) || null

  const selectedStats = selectedQuiz ? quizStatsById[selectedQuiz.id] || null : null
  const totalStudents = selectedStats?.total_students ?? participants.length
  const joinedCount = selectedStats?.started_count ?? participants.filter((p) => p.submission?.started_at).length
  const notStartedCount = Math.max(0, totalStudents - joinedCount)
  const attemptedStudents = useMemo(() => (
    participants
      .filter((p) => p.submission?.started_at)
      .sort((a, b) => {
        const aScore = a.submission?.score
        const bScore = b.submission?.score
        if (aScore == null && bScore != null) return 1
        if (aScore != null && bScore == null) return -1
        if (aScore != null && bScore != null && aScore !== bScore) return aScore - bScore
        return (a.nama || '').localeCompare(b.nama || '', 'id')
      })
  ), [participants])
  const notStartedStudents = useMemo(() => (
    participants
      .filter((p) => !p.submission?.started_at)
      .sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'))
  ), [participants])
  const latestRetakeByStudent = useMemo(() => {
    const map = {}
    ;(retakeLogs || []).forEach((row) => {
      if (!row?.siswa_id) return
      if (!map[row.siswa_id]) {
        map[row.siswa_id] = row
        return
      }
      const prev = safeDate(map[row.siswa_id].created_at)
      const curr = safeDate(row.created_at)
      if (!prev || (curr && curr > prev)) {
        map[row.siswa_id] = row
      }
    })
    return map
  }, [retakeLogs])

  useEffect(() => {
    const loadJadwal = async () => {
      if (!user?.id) return
      try {
        const { data } = await supabase.from('jadwal').select('*').eq('guru_id', user.id)
        setJadwal(data || [])
      } catch (err) {
        console.error(err)
      }
    }
    loadJadwal()
  }, [user?.id])

  useEffect(() => {
    const timer = setInterval(() => setNowTick(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const loadKelas = async () => {
      if (!jadwal.length) {
        setKelasList([])
        setSelectedKelas('')
        return
      }
      const kelasIds = [...new Set(jadwal.map((j) => j.kelas_id).filter(Boolean))]
      if (!kelasIds.length) {
        setKelasList([])
        return
      }
      const { data } = await supabase.from('kelas').select('*').in('id', kelasIds).order('grade').order('suffix')
      setKelasList(data || [])
      if (!selectedKelas && data?.length) setSelectedKelas(data[0].id)
    }
    loadKelas()
  }, [jadwal, selectedKelas])

  useEffect(() => {
    if (!selectedKelas) {
      setMapelList([])
      setSelectedMapel('')
      return
    }
    const mapels = jadwal
      .filter((j) => j.kelas_id === selectedKelas && j.mapel)
      .map((j) => normalizeMapel(j.mapel))
      .filter((v, i, s) => v && s.indexOf(v) === i)
      .sort()
    setMapelList(mapels)
    if (!selectedMapel && mapels.length) setSelectedMapel(mapels[0])
  }, [selectedKelas, jadwal, selectedMapel])

  const loadQuizzes = async () => {
    if (!selectedKelas || !selectedMapel) {
      setQuizList([])
      setQuizStatsById({})
      setSelectedQuizId('')
      return
    }
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .eq('kelas_id', selectedKelas)
      .eq('mapel', selectedMapel)
      .order('created_at', { ascending: false })

    const rows = data || []
    setQuizList(rows)
    if (rows.length && !selectedQuizId) setSelectedQuizId(rows[0].id)
    if (!rows.length) setSelectedQuizId('')

    if (!rows.length) {
      setQuizStatsById({})
      return
    }

    const quizIds = rows.map((q) => q.id)
    const { data: studentRows } = await supabase
      .from('profiles')
      .select('id')
      .eq('kelas', selectedKelas)
      .eq('role', 'siswa')
    const totalStudentsByClass = (studentRows || []).length

    const { data: submissionRows } = await supabase
      .from('quiz_submissions')
      .select('quiz_id, siswa_id, status')
      .in('quiz_id', quizIds)

    const summary = {}
    rows.forEach((q) => {
      summary[q.id] = {
        total_students: totalStudentsByClass,
        started_count: 0,
        finished_count: 0,
        not_started_count: totalStudentsByClass
      }
    })

    const startedSetByQuiz = {}
    ;(submissionRows || []).forEach((sub) => {
      if (!summary[sub.quiz_id]) return
      if (!startedSetByQuiz[sub.quiz_id]) startedSetByQuiz[sub.quiz_id] = new Set()
      startedSetByQuiz[sub.quiz_id].add(sub.siswa_id)
      if (sub.status === 'finished') {
        summary[sub.quiz_id].finished_count += 1
      }
    })

    Object.keys(summary).forEach((quizId) => {
      const startedCount = startedSetByQuiz[quizId] ? startedSetByQuiz[quizId].size : 0
      summary[quizId].started_count = startedCount
      summary[quizId].not_started_count = Math.max(0, summary[quizId].total_students - startedCount)
    })

    setQuizStatsById(summary)
  }

  useEffect(() => {
    loadQuizzes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKelas, selectedMapel])

  const loadQuizDetails = async () => {
    if (!selectedQuizId) {
      setQuestions([])
      setOptionsByQuestion({})
      setParticipants([])
      setRetakeLogs([])
      return
    }

    try {
      const { data: questionRows } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', selectedQuizId)
        .order('nomor', { ascending: true })

      const questionIds = (questionRows || []).map((q) => q.id)
      let optionRows = []
      if (questionIds.length) {
        const { data } = await supabase.from('quiz_options').select('*').in('question_id', questionIds)
        optionRows = data || []
      }

      const byQuestion = {}
      optionRows.forEach((opt) => {
        if (!byQuestion[opt.question_id]) byQuestion[opt.question_id] = []
        byQuestion[opt.question_id].push(opt)
      })

      const { data: siswaRows } = await supabase
        .from('profiles')
        .select('id, nama, nis')
        .eq('kelas', selectedKelas)
        .eq('role', 'siswa')
        .order('nama')

      const { data: submissionRows } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('quiz_id', selectedQuizId)

      const submissionMap = new Map((submissionRows || []).map((s) => [s.siswa_id, s]))
      const peserta = (siswaRows || []).map((s) => ({
        ...s,
        submission: submissionMap.get(s.id) || null
      }))

      let historyRows = []
      try {
        const { data, error } = await supabase.quiz.retakeHistory(selectedQuizId)
        if (!error) {
          historyRows = data || []
        }
      } catch {
        historyRows = []
      }

      setQuestions(questionRows || [])
      setOptionsByQuestion(byQuestion)
      setParticipants(peserta)
      setRetakeLogs(historyRows)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal memuat detail quiz')
    }
  }

  useEffect(() => {
    loadQuizDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuizId])

  useEffect(() => {
    if (!selectedQuiz) {
      setScheduleForm({
        starts_at: '',
        deadline_at: '',
        duration_minutes: 60
      })
      return
    }

    setScheduleForm({
      starts_at: toLocalInput(selectedQuiz.starts_at),
      deadline_at: toLocalInput(selectedQuiz.deadline_at),
      duration_minutes: Number(selectedQuiz.duration_minutes || 60)
    })
  }, [selectedQuiz?.id, selectedQuiz?.starts_at, selectedQuiz?.deadline_at, selectedQuiz?.duration_minutes])

  const resetQuizForm = () => {
    setQuizForm({
      nama: '',
      penilaian: 'poin',
      mode: 'regular'
    })
  }

  const handleCreateQuiz = async () => {
    if (!selectedKelas || !selectedMapel) {
      pushToast('error', 'Pilih kelas dan mapel terlebih dahulu')
      return
    }
    if (!quizForm.nama.trim()) {
      pushToast('error', 'Nama quiz wajib diisi')
      return
    }

    const payload = {
      id: makeId(),
      guru_id: user.id,
      kelas_id: selectedKelas,
      mapel: selectedMapel,
      nama: quizForm.nama.trim(),
      starts_at: null,
      deadline_at: null,
      penilaian: quizForm.penilaian,
      mode: quizForm.mode,
      is_live: quizForm.mode !== 'regular',
      is_active: false,
      live_started_at: null,
      duration_minutes: quizForm.mode !== 'regular' ? 60 : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    try {
      setLoading(true)
      const { error } = await supabase.from('quizzes').insert(payload)
      if (error) throw error
      pushToast('success', 'Quiz berhasil dibuat')
      resetQuizForm()
      setShowQuizForm(false)
      await loadQuizzes()
      setSelectedQuizId(payload.id)
    } catch (err) {
      pushToast('error', err?.message || 'Gagal membuat quiz')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSchedule = async () => {
    if (!selectedQuiz) return
    if (!questions.length) {
      pushToast('error', 'Tambahkan minimal 1 soal sebelum mengatur jadwal')
      return
    }
    if (!scheduleForm.starts_at) {
      pushToast('error', 'Tanggal mulai wajib diisi')
      return
    }

    const startsAt = toMinuteDate(scheduleForm.starts_at)
    if (!startsAt) {
      pushToast('error', 'Tanggal mulai tidak valid')
      return
    }
    const existingStart = toMinuteDate(selectedQuiz.starts_at)
    const hasStartChanged = !existingStart || existingStart.getTime() !== startsAt.getTime()
    const nowMinute = toMinuteDate(new Date())
    if (hasStartChanged && startsAt < nowMinute) {
      pushToast('error', 'Tanggal mulai tidak boleh di masa lalu')
      return
    }

    const mode = normalizeMode(selectedQuiz)
    const payload = {
      updated_at: new Date().toISOString()
    }
    if (hasStartChanged) {
      payload.starts_at = startsAt.toISOString()
    }

    if (mode === 'regular') {
      if (!scheduleForm.deadline_at) {
        pushToast('error', 'Tanggal selesai wajib diisi')
        return
      }
      const deadlineAt = toMinuteDate(scheduleForm.deadline_at)
      if (!deadlineAt || deadlineAt <= startsAt) {
        pushToast('error', 'Tanggal selesai harus setelah tanggal mulai')
        return
      }
      payload.deadline_at = deadlineAt.toISOString()
      payload.is_live = false
      payload.is_active = true
      payload.live_started_at = null
      payload.duration_minutes = null
    } else {
      const duration = Number(scheduleForm.duration_minutes || 0)
      if (!Number.isFinite(duration) || duration < 10) {
        pushToast('error', 'Durasi ujian minimal 10 menit')
        return
      }
      payload.is_live = true
      payload.is_active = true
      payload.duration_minutes = Math.round(duration)
      payload.live_started_at = startsAt.toISOString()
      payload.deadline_at = new Date(startsAt.getTime() + Math.round(duration) * 60000).toISOString()
    }

    try {
      setLoading(true)
      const { error } = await supabase.from('quizzes').update(payload).eq('id', selectedQuiz.id)
      if (error) throw error
      pushToast('success', 'Jadwal quiz berhasil disimpan')
      await loadQuizzes()
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan jadwal quiz')
    } finally {
      setLoading(false)
    }
  }

  const openQuestionForm = (q = null) => {
    if (!q) {
      setEditingQuestion(null)
      setQuestionForm({
        soal: '',
        poin: 10,
        options: { A: '', B: '', C: '', D: '' },
        correct: 'A'
      })
    } else {
      const opts = optionsByQuestion[q.id] || []
      const map = { A: '', B: '', C: '', D: '' }
      let correct = 'A'
      opts.forEach((o) => {
        map[o.label] = o.text
        if (o.is_correct) correct = o.label
      })
      setEditingQuestion(q)
      setQuestionForm({
        soal: q.soal || '',
        poin: q.poin || 10,
        options: map,
        correct
      })
    }
    setShowQuestionForm(true)
  }

  const handleSaveQuestion = async () => {
    if (!selectedQuizId) return
    if (!questionForm.soal.trim()) {
      pushToast('error', 'Isi soal wajib diisi')
      return
    }

    const optionEntries = ['A', 'B', 'C', 'D'].map((label) => ({
      label,
      text: questionForm.options[label] || ''
    }))

    if (optionEntries.some((o) => !o.text.trim())) {
      pushToast('error', 'Semua opsi jawaban wajib diisi')
      return
    }

    try {
      setLoading(true)
      let questionId = editingQuestion?.id
      if (!questionId) {
        questionId = makeId()
        const nextNomor = questions.length + 1
        const { error } = await supabase.from('quiz_questions').insert({
          id: questionId,
          quiz_id: selectedQuizId,
          nomor: nextNomor,
          soal: questionForm.soal.trim(),
          poin: Number(questionForm.poin || 1),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('quiz_questions')
          .update({
            soal: questionForm.soal.trim(),
            poin: Number(questionForm.poin || 1),
            updated_at: new Date().toISOString()
          })
          .eq('id', questionId)
        if (error) throw error
        await supabase.from('quiz_options').delete().eq('question_id', questionId)
      }

      const optionRows = optionEntries.map((o) => ({
        id: makeId(),
        question_id: questionId,
        label: o.label,
        text: o.text.trim(),
        is_correct: o.label === questionForm.correct,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }))
      const { error: optError } = await supabase.from('quiz_options').insert(optionRows)
      if (optError) throw optError

      pushToast('success', 'Soal berhasil disimpan')
      setShowQuestionForm(false)
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menyimpan soal')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteQuestion = async (questionId) => {
    if (!window.confirm('Hapus soal ini?')) return
    try {
      setLoading(true)
      await supabase.from('quiz_questions').delete().eq('id', questionId)
      const { data } = await supabase
        .from('quiz_questions')
        .select('id')
        .eq('quiz_id', selectedQuizId)
        .order('nomor', { ascending: true })
      const reorder = (data || []).map((q, idx) => ({
        id: q.id,
        nomor: idx + 1,
        updated_at: new Date().toISOString()
      }))
      for (const row of reorder) {
        await supabase.from('quiz_questions').update({ nomor: row.nomor, updated_at: row.updated_at }).eq('id', row.id)
      }
      await loadQuizDetails()
      pushToast('success', 'Soal dihapus')
    } catch (err) {
      pushToast('error', err?.message || 'Gagal menghapus soal')
    } finally {
      setLoading(false)
    }
  }

  const handleRetakeStudent = async (student) => {
    if (!selectedQuiz || !student?.id) return
    const submission = student.submission
    if (!submission?.id) {
      pushToast('error', 'Siswa belum punya attempt quiz')
      return
    }

    const scoreInfo = submission.score != null ? `${submission.score}` : '-'
    const ok = window.confirm(
      `Apakah siswa ${student.nama} ingin mengulang quiz?\nNilai sebelum ulang: ${scoreInfo}\nJawaban sebelumnya akan direset.`
    )
    if (!ok) return

    try {
      setLoading(true)
      const { data, error } = await supabase.quiz.retake({
        quiz_id: selectedQuiz.id,
        siswa_id: student.id,
        confirmed: true
      })
      if (error) throw error

      const prevScore = data?.previous_score
      const scoreLabel = prevScore != null ? prevScore : '-'
      pushToast('success', `Quiz ${student.nama} direset. Nilai sebelum ulang: ${scoreLabel}`)
      await loadQuizzes()
      await loadQuizDetails()
    } catch (err) {
      pushToast('error', err?.message || 'Gagal reset attempt siswa')
    } finally {
      setLoading(false)
    }
  }

  const selectedStatus = useMemo(() => {
    if (!selectedQuiz) return null
    return getQuizStatus(selectedQuiz, nowTick)
  }, [selectedQuiz, nowTick])

  const selectedRemainingSeconds = useMemo(() => {
    if (!selectedQuiz || !selectedStatus || selectedStatus.kind !== 'active') return null
    return getRemainingSeconds(selectedQuiz, nowTick)
  }, [selectedQuiz, selectedStatus, nowTick])

  const startInputMin = useMemo(() => {
    if (!selectedQuiz) return getNowLocalInput()
    const existingStart = safeDate(selectedQuiz.starts_at)
    if (existingStart && existingStart < nowTick) {
      return toLocalInput(existingStart)
    }
    return getNowLocalInput()
  }, [selectedQuiz, nowTick])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 sm:p-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 transition-all duration-300 hover:shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-3 h-12 bg-gradient-to-b from-indigo-500 to-blue-600 rounded-full"></div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 mb-1">Kelola Quiz</h1>
                <p className="text-slate-600 text-base">Atur quiz untuk kelas yang Anda ampu dengan jadwal terstruktur.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="bg-gradient-to-r from-gray-50 to-indigo-50 border border-indigo-100 rounded-2xl px-4 py-3">
                <div className="text-xs text-slate-500">Guru Aktif</div>
                <div className="font-semibold text-slate-800">{user?.email || '-'}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowQuizForm(true)}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold hover:from-indigo-700 hover:to-blue-700 transition-all shadow-sm hover:shadow-md"
              >
                + Buat Quiz
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Kelas</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm shadow-sm"
                value={selectedKelas}
                onChange={(e) => setSelectedKelas(e.target.value)}
              >
                {kelasList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.nama || k.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Mata Pelajaran</label>
              <select
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm shadow-sm"
                value={selectedMapel}
                onChange={(e) => setSelectedMapel(e.target.value)}
              >
                {mapelList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Daftar Quiz</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{quizList.length} quiz tersedia</p>
                </div>
              </div>
              <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-semibold">
                {selectedMapel || 'Semua mapel'}
              </span>
            </div>
            <div className="p-4 space-y-3 max-h-[calc(100vh-260px)] overflow-y-auto">
              {quizList.length === 0 && (
                <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                  Belum ada quiz.
                </div>
              )}
              {quizList.map((q) => {
                const status = getQuizStatus(q, nowTick)
                const stats = quizStatsById[q.id] || {}
                const remainingSeconds = status.kind === 'active' ? getRemainingSeconds(q, nowTick) : null
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQuizId(q.id)}
                    className={`w-full text-left border-2 rounded-2xl p-4 transition-all duration-300 ${
                      selectedQuizId === q.id
                        ? 'border-indigo-400 bg-gradient-to-r from-indigo-50 to-blue-50 shadow-sm shadow-indigo-100/60'
                        : status.kind === 'expired'
                          ? 'border-red-200 bg-gradient-to-r from-red-50/90 to-rose-50/40 hover:border-red-300 hover:shadow-sm'
                          : status.kind === 'active'
                            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50/90 to-green-50/50 hover:border-emerald-300 hover:shadow-sm'
                            : 'border-amber-200 bg-gradient-to-r from-amber-50/90 to-yellow-50/40 hover:border-amber-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900 text-base">{q.nama}</div>
                      <span className={`inline-flex text-[11px] px-2 py-0.5 rounded-full border ${status.tone}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{getModeLabel(q)}</div>
                    <div className="text-[11px] text-slate-500 mt-2">
                      Mulai: {q.starts_at ? formatDateTime(q.starts_at) : '-'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Selesai: {q.deadline_at ? formatDateTime(q.deadline_at) : '-'}
                    </div>
                    <div className="mt-3 text-[11px] text-slate-600 flex flex-wrap gap-2">
                      <span className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200">Total: {stats.total_students ?? 0}</span>
                      <span className="px-2 py-1 rounded-lg bg-white/80 border border-slate-200">Belum: {stats.not_started_count ?? 0}</span>
                    </div>
                    {remainingSeconds != null && (
                      <div className="mt-2 text-[11px] font-semibold text-emerald-700">
                        Sisa waktu: {formatRemaining(remainingSeconds)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

        <div className="lg:col-span-2 space-y-6">
          {!selectedQuiz && (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 shadow-sm">
              Pilih quiz untuk melihat detail.
            </div>
          )}

          {selectedQuiz && (
            <>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{selectedQuiz.nama}</h3>
                      <p className="text-sm text-slate-500">{getModeLabel(selectedQuiz)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {selectedStatus && (
                      <span className={`inline-flex w-fit text-xs px-3 py-1 rounded-full border ${selectedStatus.tone}`}>
                        {selectedStatus.label}
                      </span>
                    )}
                    {selectedRemainingSeconds != null && (
                      <span className="text-xs font-semibold text-emerald-700">
                        Timer: {formatRemaining(selectedRemainingSeconds)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 text-slate-700">
                    Total siswa mapel: <span className="font-semibold text-slate-900">{totalStudents}</span>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 text-slate-700">
                    Sudah mengerjakan: <span className="font-semibold text-slate-900">{joinedCount}</span>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 text-slate-700">
                    Belum mengerjakan: <span className="font-semibold text-slate-900">{notStartedCount}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-emerald-600 rounded-full"></div>
                    <h3 className="text-lg font-bold text-slate-900">Jadwal Quiz</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveSchedule}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
                  >
                    Simpan Jadwal
                  </button>
                </div>
                <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-semibold text-slate-600">Tanggal Mulai</label>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      min={startInputMin}
                      value={scheduleForm.starts_at}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, starts_at: e.target.value }))}
                    />
                  </div>
                  {normalizeMode(selectedQuiz) === 'regular' ? (
                    <div>
                      <label className="text-sm font-semibold text-slate-600">Tanggal Selesai</label>
                      <input
                        type="datetime-local"
                        className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        min={scheduleForm.starts_at || getNowLocalInput()}
                        value={scheduleForm.deadline_at}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, deadline_at: e.target.value }))}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-sm font-semibold text-slate-600">Durasi (menit)</label>
                      <input
                        type="number"
                        min="10"
                        className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        value={scheduleForm.duration_minutes}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, duration_minutes: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/70">
                  Alur: buat soal dulu, lalu atur jadwal. Setelah jadwal aktif, siswa bisa mulai quiz otomatis.
                </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
                    <h3 className="text-lg font-bold text-slate-900">Soal Quiz</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => openQuestionForm()}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    + Tambah Soal
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  {questions.length === 0 && (
                    <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                      Belum ada soal.
                    </div>
                  )}
                  {questions.map((q) => (
                    <div key={q.id} className="border border-slate-200 rounded-2xl p-4 bg-white transition-all duration-300 hover:shadow-sm hover:border-indigo-200">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900">
                          Soal {q.nomor} • {q.poin} poin
                        </div>
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => openQuestionForm(q)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-slate-700 mt-2">{q.soal}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                        {(optionsByQuestion[q.id] || [])
                          .sort((a, b) => a.label.localeCompare(b.label))
                          .map((opt) => (
                            <div
                              key={opt.id}
                              className={`text-sm px-3 py-2 rounded-xl border ${
                                opt.is_correct ? 'border-green-400 bg-green-50 text-green-700 shadow-sm' : 'border-slate-200 bg-slate-50/40'
                              }`}
                            >
                              <span className="font-semibold mr-2">{opt.label}.</span>
                              {opt.text}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-md">
                <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 bg-purple-600 rounded-full"></div>
                    <h3 className="text-lg font-bold text-slate-900">Status Siswa</h3>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {!participants.length && (
                    <div className="text-sm text-slate-500 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50">
                      Belum ada siswa di kelas ini.
                    </div>
                  )}
                  {!!participants.length && (
                    <>
                      <div>
                        <div className="text-xs font-semibold text-slate-600 mb-2">
                          Siswa sudah mengerjakan ({attemptedStudents.length})
                        </div>
                        <div className="space-y-2">
                          {!attemptedStudents.length && (
                            <div className="text-xs text-slate-500 p-3 border border-dashed border-slate-200 rounded-xl">
                              Belum ada siswa yang mulai mengerjakan.
                            </div>
                          )}
                          {attemptedStudents.map((p) => {
                            const sub = p.submission
                            const status = sub?.status === 'finished' ? 'Selesai' : 'Mengerjakan'
                            const durationText = formatDurationText(sub?.started_at, sub?.finished_at || nowTick)
                            const latestRetake = latestRetakeByStudent[p.id] || null
                            const prevScoreText = latestRetake?.previous_score != null ? latestRetake.previous_score : '-'
                            return (
                              <div
                                key={p.id}
                                className="flex items-center justify-between p-3 border border-slate-200 rounded-xl bg-white hover:border-emerald-200 transition-all duration-300"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold flex items-center justify-center">
                                    {(p.nama || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                  <div className="font-semibold text-slate-900">{p.nama}</div>
                                  <div className="text-xs text-slate-500">NIS: {p.nis || '-'}</div>
                                  <div className="text-xs text-slate-500">Durasi: {durationText}</div>
                                  {latestRetake && (
                                    <div className="text-[11px] text-indigo-600 mt-1">
                                      Nilai sebelum ulang: {prevScoreText} • {formatDateTime(latestRetake.created_at)}
                                    </div>
                                  )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span
                                    className={`text-xs px-2 py-1 rounded-full ${
                                      sub?.status === 'finished'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-yellow-100 text-yellow-700'
                                    }`}
                                  >
                                    {status}
                                  </span>
                                  <div className="text-sm font-semibold text-slate-700 min-w-16 text-right">
                                    {sub?.score != null ? `${sub.score}` : '-'}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRetakeStudent(p)}
                                    className="text-xs px-3 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                                  >
                                    Ulang Quiz
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100">
                        <div className="text-xs font-semibold text-slate-600 mb-2">
                          Siswa belum mengerjakan ({notStartedStudents.length})
                        </div>
                        <div className="space-y-2">
                          {!notStartedStudents.length && (
                            <div className="text-xs text-emerald-600 p-3 border border-emerald-200 bg-emerald-50 rounded-xl">
                              Semua siswa sudah mengerjakan quiz.
                            </div>
                          )}
                          {notStartedStudents.map((s) => {
                            const latestRetake = latestRetakeByStudent[s.id] || null
                            const prevScoreText = latestRetake?.previous_score != null ? latestRetake.previous_score : '-'
                            return (
                              <div
                                key={s.id}
                                className="flex items-center justify-between p-3 border border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50 rounded-xl"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 text-sm font-semibold flex items-center justify-center">
                                    {(s.nama || '?').charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                  <div className="font-semibold text-slate-900">{s.nama}</div>
                                  <div className="text-xs text-slate-500">NIS: {s.nis || '-'}</div>
                                  {latestRetake && (
                                    <div className="text-[11px] text-indigo-600 mt-1">
                                      Nilai sebelum ulang: {prevScoreText} • {formatDateTime(latestRetake.created_at)}
                                    </div>
                                  )}
                                  </div>
                                </div>
                                <span className="text-[11px] px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                                  Belum mulai
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                  {!!participants.length && (
                    <div className="text-xs text-slate-500 pt-2">
                      Nilai dihitung otomatis oleh sistem (
                      {selectedQuiz?.penilaian === 'skala_100'
                        ? 'jumlah benar / total soal x 100'
                        : 'bobot poin soal x 100'}
                      ). Guru tidak bisa input nilai manual.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      {showQuizForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 space-y-4 border border-slate-200 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Buat Quiz Baru</h3>
            <div>
              <label className="text-sm font-semibold text-slate-600">Nama Quiz</label>
              <input
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={quizForm.nama}
                onChange={(e) => setQuizForm((prev) => ({ ...prev, nama: e.target.value }))}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500">
                Jadwal belum diisi di langkah ini. Setelah quiz dibuat, kamu bisa tambah soal dulu lalu atur
                tanggal mulai dan deadline di panel detail quiz.
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-sm font-semibold text-slate-600">Sistem Penilaian</label>
                <select
                  className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                  value={quizForm.penilaian}
                  onChange={(e) => setQuizForm((prev) => ({ ...prev, penilaian: e.target.value }))}
                >
                  <option value="poin">Poin (0-100)</option>
                  <option value="skala_100">Skala 0-100</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-600">Mode</label>
                <select
                  className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                  value={quizForm.mode}
                  onChange={(e) => setQuizForm((prev) => ({ ...prev, mode: e.target.value }))}
                >
                  <option value="regular">Reguler</option>
                  <option value="uts">UTS</option>
                  <option value="uas">UAS</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
                <button
                  type="button"
                onClick={() => {
                  resetQuizForm()
                  setShowQuizForm(false)
                }}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleCreateQuiz}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                >
                  Simpan
                </button>
            </div>
          </div>
        </div>
      )}

      {showQuestionForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-xl p-6 space-y-4 border border-slate-200 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">
              {editingQuestion ? 'Edit Soal' : 'Tambah Soal'}
            </h3>
            <div>
              <label className="text-sm font-semibold text-slate-600">Soal</label>
              <textarea
                rows="3"
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={questionForm.soal}
                onChange={(e) => setQuestionForm((prev) => ({ ...prev, soal: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-600">Poin Soal</label>
              <select
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={questionForm.poin}
                onChange={(e) => setQuestionForm((prev) => ({ ...prev, poin: Number(e.target.value) }))}
              >
                {POINT_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p} poin</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {['A', 'B', 'C', 'D'].map((label) => (
                <div key={label}>
                  <label className="text-xs font-semibold text-slate-500">Pilihan {label}</label>
                  <input
                    className={`mt-1 w-full border rounded-xl px-4 py-3 ${
                      questionForm.correct === label ? 'border-green-400 bg-green-50' : 'border-slate-200'
                    }`}
                    value={questionForm.options[label]}
                    onChange={(e) =>
                      setQuestionForm((prev) => ({
                        ...prev,
                        options: { ...prev.options, [label]: e.target.value }
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-600">Jawaban Benar</label>
              <select
                className="mt-1 w-full border border-slate-300 rounded-xl px-4 py-3"
                value={questionForm.correct}
                onChange={(e) => setQuestionForm((prev) => ({ ...prev, correct: e.target.value }))}
              >
                {['A', 'B', 'C', 'D'].map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQuestionForm(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveQuestion}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
              >
                Simpan Soal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
