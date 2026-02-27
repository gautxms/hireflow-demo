import app from './app.js'
import stripeRoutes from './routes/stripe.js'

app.use('/api/stripe', stripeRoutes)

export default app
