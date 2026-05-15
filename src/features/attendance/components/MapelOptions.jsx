import React, { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { getDayName, getToday } from '../utils/attendanceDate'

export default function MapelOptions({ kelas, tanggal, periodFilter }) {
  const [list, setList] = useState([])

  useEffect(() => {
    if (!kelas) return

    const load = async () => {
      try {
        const hari = tanggal ? getDayName(tanggal) : getDayName(getToday())

        let query = supabase
          .from('jadwal')
          .select('mapel, guru_nama, jam_mulai, jam_selesai, hari')
          .eq('kelas_id', kelas)
          .eq('hari', hari)

        if (periodFilter?.tahunAjaran) query = query.eq('tahun_ajaran', periodFilter.tahunAjaran)
        if (periodFilter?.semester) query = query.eq('semester', periodFilter.semester)

        const { data, error } = await query

        if (error) throw error

        const uniqueMap = new Map()
        ; (data || []).forEach((d) => {
          if (!uniqueMap.has(d.mapel)) uniqueMap.set(d.mapel, d)
        })

        const uniqueList = Array.from(uniqueMap.values()).sort((a, b) =>
          a.mapel.localeCompare(b.mapel)
        )
        setList(uniqueList)
      } catch (err) {
        console.error('Error load mapel options:', err)
      }
    }

    load()
  }, [kelas, tanggal, periodFilter?.semester, periodFilter?.tahunAjaran])

  return (
    <>
      {list.map((m) => (
        <option key={m.mapel} value={m.mapel}>
          {m.mapel} {m.guru_nama ? `(${m.guru_nama})` : ''} - {m.jam_mulai}-
          {m.jam_selesai}
        </option>
      ))}
    </>
  )
}
