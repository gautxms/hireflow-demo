import { useState } from 'react'
import ResumeUploader from './ResumeUploader'
import CandidateRanking from './CandidateRanking'

export default function Dashboard({ onBack }) {
  const [hasUploaded, setHasUploaded] = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)

  const handleFileUploaded = (file) => {
    setUploadedFile(file)
    setHasUploaded(true)
  }

  const handleReset = () => {
    setHasUploaded(false)
    setUploadedFile(null)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              ← Back
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Candidate Screening</h1>
          </div>
          {hasUploaded && (
            <button
              onClick={handleReset}
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg transition"
            >
              Upload New File
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!hasUploaded ? (
          <ResumeUploader onFileUploaded={handleFileUploaded} />
        ) : (
          <CandidateRanking uploadedFile={uploadedFile} />
        )}
      </main>
    </div>
  )
}
