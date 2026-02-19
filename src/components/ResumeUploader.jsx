import { useState } from 'react'

export default function ResumeUploader({ onFileUploaded }) {
  const [isDragActive, setIsDragActive] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true)
    } else if (e.type === 'dragleave') {
      setIsDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)

    const files = [...e.dataTransfer.files]
    handleFiles(files)
  }

  const handleFileInput = (e) => {
    const files = [...e.target.files]
    handleFiles(files)
  }

  const handleFiles = (files) => {
    const validFiles = files.filter(
      (file) => file.type === 'application/pdf' || file.type === 'text/plain'
    )

    if (validFiles.length === 0) {
      alert('Please upload PDF or TXT files only')
      return
    }

    setUploadedFiles(validFiles)

    // Simulate parsing and then show results
    setIsProcessing(true)
    setTimeout(() => {
      setIsProcessing(false)
      // Call parent to move to results page
      onFileUploaded(validFiles[0])
    }, 2000)
  }

  return (
    <div className="space-y-8 pb-8">
      {/* Upload Area */}
      <div
        className={`relative border-3 border-dashed rounded-3xl p-12 sm:p-16 text-center transition-all duration-200 ${
          isDragActive
            ? 'border-indigo-500 bg-indigo-50 shadow-xl scale-105'
            : 'border-slate-300 bg-white hover:border-indigo-400'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="mb-6">
          <div className="text-6xl mb-6">📄</div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 mb-3">
            Upload Resumes
          </h2>
          <p className="text-lg text-slate-600 mb-2">
            Drag and drop your resume files here, or click to browse
          </p>
          <p className="text-sm text-slate-500 font-medium">
            Accepted formats: PDF, TXT • Multiple files supported
          </p>
        </div>

        <input
          type="file"
          multiple
          accept=".pdf,.txt"
          onChange={handleFileInput}
          className="hidden"
          id="file-input"
          disabled={isProcessing}
        />

        <label htmlFor="file-input">
          <button
            onClick={() => document.getElementById('file-input').click()}
            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-black py-4 px-10 rounded-xl text-lg shadow-xl hover:shadow-2xl transition cursor-pointer inline-block transform hover:scale-105 disabled:opacity-50"
            disabled={isProcessing}
          >
            {isProcessing ? '⟳ Processing...' : 'Select Files'}
          </button>
        </label>
      </div>

      {/* Processing Status */}
      {isProcessing && (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-2xl p-8 text-center shadow-lg">
          <div className="inline-block">
            <div className="flex justify-center mb-4">
              <div className="animate-spin h-10 w-10 text-indigo-600 text-2xl">⟳</div>
            </div>
            <p className="text-indigo-900 font-bold text-lg">
              Analyzing resumes with AI...
            </p>
            <p className="text-sm text-indigo-700 mt-2">
              Scoring candidates on 20+ dimensions
            </p>
            <div className="mt-4 w-48 h-1 bg-indigo-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-600 to-blue-600 animate-pulse"></div>
            </div>
          </div>
        </div>
      )}

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && !isProcessing && (
        <div className="bg-white rounded-2xl border-2 border-green-200 p-8 shadow-lg">
          <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <span className="text-2xl">✓</span>
            Files Selected ({uploadedFiles.length})
          </h3>
          <ul className="space-y-3">
            {uploadedFiles.map((file, idx) => (
              <li
                key={idx}
                className="flex items-center gap-4 text-slate-700 bg-green-50 p-4 rounded-lg border border-green-100"
              >
                <span className="text-xl text-green-600 font-bold">✓</span>
                <span className="font-semibold flex-1">{file.name}</span>
                <span className="text-sm text-slate-500 font-medium">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* How It Works */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border-2 border-slate-200 p-8">
        <h3 className="font-black text-slate-900 mb-4 text-lg">✨ How It Works:</h3>
        <ol className="space-y-3 text-slate-700">
          {[
            'Upload one or more resumes (PDF or TXT)',
            'HireFlow AI analyzes each candidate instantly',
            'View ranked results with detailed insights',
            'Make faster, smarter hiring decisions'
          ].map((step, idx) => (
            <li key={idx} className="flex gap-4 items-start">
              <span className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                {idx + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
