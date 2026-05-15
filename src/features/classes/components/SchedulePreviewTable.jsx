import React, { memo } from 'react'

function SchedulePreviewTable({ exportDays, jadwalMatrix }) {
  return (
    <div className="mb-6 rounded-xl border border-blue-200 overflow-hidden">
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-200">
        <h4 className="font-semibold text-blue-900">Preview Jadwal Format Cetak / Export</h4>
        <p className="text-xs text-blue-700 mt-1">
          Tata letak ini mengikuti format tabel untuk PDF landscape dan Excel.
        </p>
      </div>
      <div className="overflow-auto">
        <table className="min-w-[920px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="border border-gray-900 bg-rose-100 px-2 py-2 text-center font-semibold text-gray-900"
              >
                JAM KE
              </th>
              <th
                rowSpan={2}
                className="border border-gray-900 bg-rose-100 px-2 py-2 text-center font-semibold text-gray-900"
              >
                WAKTU
              </th>
              <th
                colSpan={exportDays.length}
                className="border border-gray-900 bg-sky-500 px-2 py-2 text-center font-semibold text-gray-900"
              >
                HARI
              </th>
            </tr>
            <tr>
              {exportDays.map((day) => (
                <th
                  key={day}
                  className="border border-gray-900 bg-yellow-300 px-2 py-2 text-center font-semibold text-gray-900"
                >
                  {day.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jadwalMatrix.length > 0 ? (
              jadwalMatrix.map((slot) => (
                <tr key={slot.key} className={slot.isBreakRow ? 'bg-lime-300' : 'bg-white'}>
                  <td className="border border-gray-900 px-2 py-2 text-center font-semibold">{slot.jamKe}</td>
                  <td className="border border-gray-900 px-2 py-2 text-center font-medium whitespace-nowrap">
                    {slot.rangeLabel}
                  </td>
                  {exportDays.map((day) => (
                    <td
                      key={`${slot.key}-${day}`}
                      className="border border-gray-900 px-2 py-2 text-center align-middle"
                    >
                      {(slot.cellEntries?.[day] || []).length > 0 ? (
                        <div className="space-y-1">
                          {(slot.cellEntries[day] || []).map((entry, idx) => (
                            <div
                              key={`${slot.key}-${day}-${idx}-${entry.mapel || entry.guruNama || 'jadwal'}`}
                              className={idx > 0 ? 'border-t border-gray-300 pt-1' : ''}
                            >
                              <p className="font-medium text-gray-900 leading-tight">
                                {entry.mapel || '-'}
                              </p>
                              {entry.guruNama ? (
                                <p className="text-[11px] text-gray-600 leading-tight mt-0.5">
                                  {entry.guruNama}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={2 + exportDays.length}
                  className="border border-gray-900 px-3 py-6 text-center text-gray-500"
                >
                  Belum ada jadwal untuk kelas ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default memo(SchedulePreviewTable)
