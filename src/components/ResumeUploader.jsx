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
    <div className="space-y-8">
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-white'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="mb-4">
          <div className="text-5xl mb-4">📄</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Upload Resumes
          </h2>
          <p className="text-gray-600">
            Drag and drop your resume files here, or click to browse
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Accepted formats: PDF, TXT
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
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg text-lg shadow-lg transition cursor-pointer inline-block"
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Select Files'}
          </button>
        </label>
      </div>

      {/* Processing Status */}
      {isProcessing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <div className="inline-block">
            <div className="flex justify-center mb-4">
              <div className="animate-spin h-8 w-8 text-blue-600">⟳</div>
            </div>
            <p className="text-blue-900 font-semibold">
              Analyzing resumes with AI...
            </p>
            <p className="text-sm text-blue-700 mt-2">
              Scoring candidates based on job fit
            </p>
          </div>
        </div>
      )}

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && !isProcessing && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Files Selected ({uploadedFiles.length})
          </h3>
          <ul className="space-y-2">
            {uploadedFiles.map((file, idx) => (
              <li
                key={idx}
                className="flex items-center gap-3 text-gray-700"
              >
                <span className="text-xl">✓</span>
                <span className="font-medium">{file.name}</span>
                <span className="text-sm text-gray-500">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Help Text */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-3">How it works:</h3>
        <ol className="space-y-2 text-sm text-gray-600 list-decimal list-inside">
          <li>Upload one or more resumes (PDF or TXT)</li>
          <li>HireFlow AI analyzes each candidate's qualifications</li>
          <li>View ranked results with AI insights and recommendations</li>
          <li>Make faster, smarter hiring decisions</li>
        </ol>
      </div>
    </div>
  )
}
