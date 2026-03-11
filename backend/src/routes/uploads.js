import express from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/authMiddleware.js'
import { pool } from '../db/client.js'

const router = express.Router()
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

router.post('/', requireAuth, upload.array('resumes', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' })
    }

    // TODO: For now, return mock data
    // Later: Parse PDFs, extract text, call AI API
    const mockCandidates = [
      {
        id: '1',
        name: 'Sarah Chen',
        position: 'Senior Engineer',
        experience: '5 years',
        education: 'BS Computer Science, Stanford',
        score: 92,
        tier: 'top',
        fit: 'Excellent',
        skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
        pros: ['Strong technical background', 'Leadership experience', 'Excellent communication'],
        cons: ['May be overqualified'],
      },
      {
        id: '2',
        name: 'Miguel Alvarez',
        position: 'Full Stack Developer',
        experience: '4 years',
        education: 'BS Software Engineering, UT Austin',
        score: 86,
        tier: 'strong',
        fit: 'Strong',
        skills: ['Vue', 'Node.js', 'JavaScript', 'MongoDB', 'Docker'],
        pros: ['Versatile across frontend and backend', 'Solid product sense', 'Strong collaboration'],
        cons: ['Limited large-scale system design experience'],
      },
      {
        id: '3',
        name: 'Priya Natarajan',
        position: 'Backend Engineer',
        experience: '6 years',
        education: 'MS Computer Science, Georgia Tech',
        score: 89,
        tier: 'top',
        fit: 'Excellent',
        skills: ['Python', 'Node.js', 'PostgreSQL', 'Redis', 'Kubernetes'],
        pros: ['Deep backend architecture experience', 'Strong database optimization skills', 'Mentors junior engineers'],
        cons: ['Less recent frontend exposure'],
      },
      {
        id: '4',
        name: 'Jordan Kim',
        position: 'Software Engineer',
        experience: '3 years',
        education: 'BS Information Systems, UC Irvine',
        score: 81,
        tier: 'good',
        fit: 'Good',
        skills: ['React', 'TypeScript', 'Express', 'MySQL', 'GCP'],
        pros: ['Fast learner', 'Strong testing discipline', 'Reliable delivery'],
        cons: ['Needs more leadership experience'],
      },
    ]

    // Keep reference to pool for future DB persistence integration
    void pool

    res.json({ candidates: mockCandidates })
  } catch (error) {
    console.error('Upload error:', error)
    res.status(500).json({ error: 'Upload processing failed' })
  }
})

export default router
