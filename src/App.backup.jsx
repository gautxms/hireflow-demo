export default function App() {
  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen">
      <Navbar />
      <Hero />
      <WhatWeDo />
      <HowItWorks />
      <WhyHireflow />
      <CTA />
      <Footer />
    </div>
  )
}

/* ------------------ NAVBAR ------------------ */
function Navbar() {
  return (
    <nav className="flex justify-between items-center px-8 py-6 max-w-7xl mx-auto">
      <div className="text-xl font-bold">Hireflow</div>
      <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500">
        Get Started
      </button>
    </nav>
  )
}

/* ------------------ HERO ------------------ */
function Hero() {
  return (
    <section className="px-8 pt-20 pb-28 max-w-7xl mx-auto">
      <h1 className="text-5xl font-bold text-red-600 bg-yellow-200">
        Tailwind test <span className="text-indigo-600">Faster.</span>
      </h1>

      <p className="mt-6 text-lg text-slate-600 max-w-2xl">
        Hireflow helps you screen resumes, shortlist candidates, and make better
        hiring decisions using AI.
      </p>

      <div className="mt-10 flex gap-4">
        <button className="bg-indigo-600 text-white px-6 py-3 rounded-lg text-lg hover:bg-indigo-500">
          Try Hireflow
        </button>
        <button className="border border-slate-300 px-6 py-3 rounded-lg text-lg hover:bg-slate-100">
          Learn More
        </button>
      </div>
    </section>
  )
}

/* ------------------ WHAT WE DO ------------------ */
function WhatWeDo() {
  const items = [
    {
      title: "AI Resume Screening",
      desc: "Automatically analyze resumes and rank candidates based on role relevance.",
    },
    {
      title: "ATS Friendly",
      desc: "Designed to fit seamlessly into existing hiring workflows.",
    },
    {
      title: "Smart Shortlisting",
      desc: "Spend time only on the candidates that truly matter.",
    },
  ]

  return (
    <section className="px-8 py-24 bg-white">
      <div className="max-w-7xl mx-auto grid md:grid-cols-3 gap-8">
        {items.map((item) => (
          <div
            key={item.title}
            className="p-8 rounded-2xl border border-slate-200 hover:shadow-lg transition"
          >
            <h3 className="text-xl font-semibold">{item.title}</h3>
            <p className="mt-4 text-slate-600">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------ HOW IT WORKS ------------------ */
function HowItWorks() {
  return (
    <section className="px-8 py-24 max-w-7xl mx-auto">
      <h2 className="text-4xl font-bold mb-12">How it works</h2>

      <div className="grid md:grid-cols-3 gap-8">
        <Step num="1" text="Upload resumes or connect your ATS" />
        <Step num="2" text="Hireflow analyzes and ranks candidates" />
        <Step num="3" text="Review insights and shortlist faster" />
      </div>
    </section>
  )
}

function Step({ num, text }) {
  return (
    <div className="bg-slate-100 p-8 rounded-xl">
      <div className="text-indigo-600 text-3xl font-bold">{num}</div>
      <p className="mt-4 text-slate-700">{text}</p>
    </div>
  )
}

/* ------------------ WHY HIRELOW ------------------ */
function WhyHireflow() {
  const points = [
    "Reduce time-to-hire",
    "Remove unconscious bias",
    "Improve candidate quality",
    "Make data-driven decisions",
  ]

  return (
    <section className="px-8 py-24 bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl font-bold mb-12">Why Hireflow</h2>

        <ul className="grid md:grid-cols-2 gap-6 text-slate-300">
          {points.map((p) => (
            <li
              key={p}
              className="bg-slate-800 p-6 rounded-xl"
            >
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------ CTA ------------------ */
function CTA() {
  return (
    <section className="px-8 py-24 bg-indigo-600 text-center text-white">
      <h2 className="text-4xl font-bold">
        Ready to improve your hiring process?
      </h2>
      <p className="mt-4 text-indigo-100">
        Start using Hireflow today.
      </p>
      <button className="mt-8 bg-white text-indigo-600 px-8 py-3 rounded-lg text-lg font-semibold">
        Get Started
      </button>
    </section>
  )
}

/* ------------------ FOOTER ------------------ */
function Footer() {
  return (
    <footer className="px-8 py-12 text-center text-slate-500">
      © {new Date().getFullYear()} Hireflow. All rights reserved.
    </footer>
  )
}
