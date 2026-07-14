import React, { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { filterSchedulesForSemester } from '../../../utils/schedulePeriodScope'
import { getDayName, getToday } from '../utils/attendanceDate'
import { scheduleService } from '../../../services/scheduleService'

const USE_SCHEDULES_API_V2 = import.meta.env.VITE_USE_SCHEDULES_API_V2 === 'true'

export default function MapelOptions({ kelas, tanggal, periodFilter }) {
  const [list, setList] = useState([])

  useEffect(() => {
    if (!kelas) return

    const load = async () => {
      try {
        const hari = tanggal ? getDayName(tanggal) : getDayName(getToday())

        let data
        if (USE_SCHEDULES_API_V2) {
          const payload = await scheduleService.listSubjectOptions({
            kelas_id: kelas,
            hari,
            tahun_ajaran: periodFilter?.tahunAjaran
          })
          data = payload.data || []
        } else {
          let query = supabase
            .from('jadwal')
            .select('mapel, guru_nama, jam_mulai, jam_selesai, hari, periode_berlaku')
            .eq('kelas_id', kelas)
            .eq('hari', hari)

          if (periodFilter?.tahunAjaran) query = query.eq('tahun_ajaran', periodFilter.tahunAjaran)

          const response = await query
          if (response.error) throw response.error
          data = response.data || []
        }

        const uniqueMap = new Map()
        ; (filterSchedulesForSemester(data, periodFilter?.semester)).forEach((d) => {
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
