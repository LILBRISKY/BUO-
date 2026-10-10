import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Heart,
  MessageSquareText,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
  X,
} from 'lucide-react'

const currency = (value) =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(value)

const apiUrl = (path) => `${import.meta.env.VITE_API_BASE_URL || ''}${path}`

const formatRating = (value) => Number(value || 0).toFixed(1)

function App() {
  const [categories, setCategories] = useState(['All'])
  const [catalog, setCatalog] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [cart, setCart] = useState([])
  const [wishlist, setWishlist] = useState([])
  const [notice, setNotice] = useState('')
  const [serviceStatus, setServiceStatus] = useState({ database: 'checking', gemini: 'checking' })
  const [deliveryOptions, setDeliveryOptions] = useState([
    { id: 'standard', label: 'Standard delivery', fee: 2500 },
    { id: 'express', label: 'Express delivery', fee: 6000 },
    { id: 'pickup', label: 'Pickup', fee: 0 },
  ])
  const [aiOpen, setAiOpen] = useState(false)
  const [analytics, setAnalytics] = useState({
    revenue: 0,
    orders: 0,
    customers: 0,
    averageOrderValue: 0,
    lowStock: 0,
    topProducts: [],
  })
  const [recommendations, setRecommendations] = useState([])
  const [auth, setAuth] = useState(null)
  const [aiMessages, setAiMessages] = useState([
    {
      role: 'assistant',
      text: 'Hi! I can help you find a great Nigerian shopping pick in minutes.',
    },
  ])
  const [aiInput, setAiInput] = useState('')
  const [aiConversationId, setAiConversationId] = useState('new')
  const [aiLoading, setAiLoading] = useState(false)
  const [guestOrder, setGuestOrder] = useState(null)
  const [checkoutForm, setCheckoutForm] = useState({
    name: 'Ada Okafor',
    email: 'ada@buo.ng',
    phone: '+2348123456789',
    state: 'Lagos',
    city: 'Ikeja',
    area: 'Alausa',
    street: '8 Oregun Road',
    delivery: 'standard',
    instructions: 'Leave at the gate if no one is home.',
  })

  useEffect(() => {
    fetch(apiUrl('/health'))
      .then((response) => response.json())
      .then((status) => setServiceStatus(status))
      .catch(() => setServiceStatus({ database: 'unavailable', gemini: 'unavailable' }))
  }, [])

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const res = await fetch(apiUrl('/api/categories'))
        const data = await res.json()
        if (data?.data) {
          setCategories(['All', ...data.data])
        }
      } catch {
        setCategories(['All', 'Phones', 'Laptops', 'Electronics', 'Gaming'])
      }
    }

    const loadProducts = async () => {
      const params = new URLSearchParams()
      if (searchTerm) params.set('search', searchTerm)
      if (selectedCategory !== 'All') params.set('category', selectedCategory)
      params.set('limit', '12')

      try {
        const res = await fetch(apiUrl(`/api/products?${params.toString()}`))
        const data = await res.json()
        setCatalog(data?.data || [])
      } catch {
        setCatalog([])
      }
    }

    const loadRecommendations = async () => {
      try {
        const res = await fetch(apiUrl('/api/recommendations'))
        const data = await res.json()
        setRecommendations(data?.data || [])
      } catch {
        setRecommendations([])
      }
    }

    const loadDeliveryOptions = async () => {
      try {
        const response = await fetch(apiUrl('/api/delivery-options'))
        const data = await response.json()
        if (data?.success && Array.isArray(data.data)) setDeliveryOptions(data.data)
      } catch {
        setNotice('Could not load delivery prices from the server.')
      }
    }

    const loadAnalytics = async () => {
      try {
        const res = await fetch(apiUrl('/api/admin/analytics'), {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('buoToken') || ''}`,
          },
        })
        const data = await res.json()
        if (data?.success) {
          setAnalytics(data.data)
        }
      } catch {
        setAnalytics({
          revenue: 31000000,
          orders: 284,
          customers: 1840,
          averageOrderValue: 108000,
          lowStock: 11,
          topProducts: [
            { name: 'iPhone 15 Pro', revenue: 5400000 },
            { name: 'MacBook Air M3', revenue: 4800000 },
          ],
        })
      }
    }

    loadCategories()
    loadProducts()
    loadRecommendations()
    loadDeliveryOptions()
    loadAnalytics()
  }, [searchTerm, selectedCategory])

  useEffect(() => {
    const token = localStorage.getItem('buoToken')
    if (!token) return

    fetch(apiUrl('/api/me'), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) {
          setAuth(data.user)
          Promise.all([
            fetch(apiUrl('/api/cart'), { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json()),
            fetch(apiUrl('/api/wishlist'), { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json()),
          ]).then(([cartData, wishlistData]) => {
            if (cartData?.success) {
              setCart(cartData.data.items.map((item) => ({
                ...item,
                id: item.productId,
                cartItemId: item.id,
                images: item.image ? [item.image] : [],
              })))
            }
            if (wishlistData?.success) setWishlist(wishlistData.data.map((item) => item.id))
          }).catch(() => setNotice('Could not load your saved cart and wishlist.'))
        }
      })
      .catch(() => {
        localStorage.removeItem('buoToken')
      })
  }, [])

  const filteredProducts = useMemo(() => catalog, [catalog])
  const totals = useMemo(() => {
    const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0)
    const delivery = cart.length
      ? deliveryOptions.find((option) => option.id === checkoutForm.delivery)?.fee || 0
      : 0
    const total = subtotal + delivery
    return { subtotal, delivery, total }
  }, [cart, checkoutForm.delivery, deliveryOptions])

  const refreshUserCart = async (token) => {
    const response = await fetch(apiUrl('/api/cart'), { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json()
    if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not refresh your cart.')
    setCart(data.data.items.map((item) => ({
      ...item,
      id: item.productId,
      cartItemId: item.id,
      images: item.image ? [item.image] : [],
    })))
  }

  const addToCart = async (product) => {
    const token = localStorage.getItem('buoToken')
    if (token && auth) {
      try {
        const response = await fetch(apiUrl('/api/cart/items'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ productId: product.id, quantity: 1 }),
        })
        const data = await response.json()
        if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not add this product to your cart.')
        await refreshUserCart(token)
        setNotice(`${product.name} added to your saved cart.`)
      } catch (error) {
        setNotice(error.message)
      }
      return
    }
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id)
      if (existing) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        )
      }
      return [...current, { ...product, quantity: 1 }]
    })
    setNotice(`${product.name} added to your cart.`)
  }

  const updateCartQuantity = async (productId, change) => {
    const currentItem = cart.find((item) => item.id === productId)
    const token = localStorage.getItem('buoToken')
    if (token && auth && currentItem?.cartItemId) {
      try {
        const response = await fetch(apiUrl(`/api/cart/items/${currentItem.cartItemId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ quantity: Math.max(1, currentItem.quantity + change) }),
        })
        const data = await response.json()
        if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not update your cart.')
        await refreshUserCart(token)
      } catch (error) {
        setNotice(error.message)
      }
      return
    }
    setCart((current) =>
      current
        .map((item) =>
          item.id === productId ? { ...item, quantity: Math.max(1, item.quantity + change) } : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }

  const toggleWishlist = async (productId) => {
    const token = localStorage.getItem('buoToken')
    if (token && auth) {
      const removing = wishlist.includes(productId)
      try {
        const response = await fetch(apiUrl(`/api/wishlist/${productId}`), {
          method: removing ? 'DELETE' : 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = response.status === 204 ? {} : await response.json()
        if (!response.ok || (data.success === false)) throw new Error(data?.error || 'Could not update your wishlist.')
        setWishlist((current) => removing
          ? current.filter((id) => id !== productId)
          : [...new Set([...current, productId])])
      } catch (error) {
        setNotice(error.message)
      }
      return
    }
    setWishlist((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId],
    )
  }

  const loginDemo = async () => {
    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ada@buo.ng', password: 'password123' }),
      })
      const data = await response.json()
      if (!response.ok || !data?.token) throw new Error(data?.error || 'Login failed.')
      localStorage.setItem('buoToken', data.token)
      setAuth(data.user)
      for (const item of cart) {
        const cartResponse = await fetch(apiUrl('/api/cart/items'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
          body: JSON.stringify({ productId: item.id, quantity: item.quantity }),
        })
        const cartData = await cartResponse.json()
        if (!cartResponse.ok || !cartData?.success) {
          throw new Error(cartData?.error || 'Could not move your guest cart to your account.')
        }
      }
      await refreshUserCart(data.token)
      const wishlistResponse = await fetch(apiUrl('/api/wishlist'), {
        headers: { Authorization: `Bearer ${data.token}` },
      })
      const wishlistData = await wishlistResponse.json()
      if (wishlistData?.success) setWishlist(wishlistData.data.map((item) => item.id))
    } catch (error) {
      setNotice(error.message || 'Login failed. Check the backend connection and development seed.')
    }
  }

  const checkoutOrder = async (event) => {
    event.preventDefault()
    if (!cart.length) return

    if (auth) {
      try {
        const body = {
          deliveryMethod: checkoutForm.delivery,
          address: {
            fullName: checkoutForm.name,
            email: checkoutForm.email,
            phone: checkoutForm.phone,
            state: checkoutForm.state,
            city: checkoutForm.city,
            area: checkoutForm.area,
            streetAddress: checkoutForm.street,
            deliveryInstructions: checkoutForm.instructions,
          },
        }

        const res = await fetch(apiUrl('/api/orders'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('buoToken')}`,
          },
          body: JSON.stringify(body),
        })

        const data = await res.json()
        if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not place your order.')
        setCart([])
        setGuestOrder({
          id: data.data.id,
          status: data.data.status,
          mode: data.data.paymentMode || 'DEMO',
        })
      } catch (error) {
        setNotice(error.message || 'Could not place your order.')
      }
      return
    }

    setGuestOrder({
      id: `BUO-${Date.now()}`,
      status: 'PENDING_PAYMENT',
      mode: 'DEMO_PREVIEW',
      total: totals.total,
    })
    setCart([])
  }

  const sendAiPrompt = async () => {
    const trimmed = aiInput.trim()
    if (!trimmed || aiLoading) return

    setAiMessages((current) => [...current, { role: 'user', text: trimmed }])
    setAiInput('')
    setAiLoading(true)

    try {
      const response = await fetch(apiUrl(`/api/ai/conversations/${aiConversationId}/messages`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await response.json()
      if (!response.ok || !data?.success) throw new Error(data?.error || 'AI request failed.')
      setAiConversationId(data.data.conversationId)
      setAiMessages((current) => [...current, {
        role: 'assistant',
        text: data.data.reply.text,
        products: data.data.reply.data || [],
      }])
    } catch (error) {
      setAiMessages((current) => [
        ...current,
        { role: 'assistant', text: error.message || 'AI is currently unavailable. Check the backend configuration and try again.' },
      ])
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fffaf2] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-amber-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 font-black text-white shadow-lg shadow-amber-200">
              B
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-500">BUO</p>
              <p className="text-sm text-slate-600">Nigerian marketplace</p>
            </div>
          </div>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-700 lg:flex">
            <a href="#shop" className="transition hover:text-amber-600">Shop</a>
            <a href="#deals" className="transition hover:text-amber-600">Deals</a>
            <a href="#ai" className="transition hover:text-amber-600">AI shopping</a>
            <a href="#orders" className="transition hover:text-amber-600">Orders</a>
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 md:flex">
              <Search size={16} className="text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search products"
                className="w-40 bg-transparent outline-none placeholder:text-slate-400"
              />
            </div>
            <button
              onClick={loginDemo}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-amber-200 hover:text-amber-600"
            >
              {auth ? `Hi, ${auth.name.split(' ')[0]}` : 'Login'}
            </button>
            <button className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800">
              <ShoppingBag size={16} />
              Cart ({cart.length})
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div role="status" className="mx-auto mt-4 flex max-w-7xl items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss notification" className="ml-4 rounded-full p-1 hover:bg-amber-100">
            <X size={16} />
          </button>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        <section className="rounded-[32px] bg-gradient-to-br from-[#fff7d5] via-white to-[#fff4ce] p-6 shadow-[0_28px_80px_rgba(251,191,36,0.08)] ring-1 ring-amber-100 lg:p-8">
          <div className="grid items-center gap-8 lg:grid-cols-[1.3fr_0.9fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
                <Sparkles size={12} />
                Smart shopping for Nigeria
              </span>
              <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-900 md:text-5xl">
                Discover products your life deserves.
              </h1>
              <p className="mt-4 max-w-xl text-base text-slate-600 md:text-lg">
                From Lagos to Port Harcourt, BUO helps shoppers compare quality essentials, unlock deals,
                and order with confidence.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="#shop"
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 font-semibold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800"
                >
                  Shop now <ArrowRight size={16} />
                </a>
                <button
                  onClick={() => setAiOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-5 py-3 font-semibold text-amber-700 transition hover:border-amber-300"
                >
                  <MessageSquareText size={16} />
                  AI shopping assistant
                </button>
              </div>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-2xl font-black text-slate-900">30k+</p>
                  <p className="text-sm text-slate-600">happy shoppers</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-2xl font-black text-slate-900">7 days</p>
                  <p className="text-sm text-slate-600">delivery support</p>
                </div>
                <div className="rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-2xl font-black text-slate-900">4.9/5</p>
                  <p className="text-sm text-slate-600">customer rating</p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] bg-white p-4 shadow-xl ring-1 ring-amber-100 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Today’s deals</p>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                  Up to 30% off
                </span>
              </div>

              <div className="mt-5 space-y-4">
                {recommendations.slice(0, 3).map((product) => (
                  <div key={product.id} className="flex items-center gap-4 rounded-2xl border border-slate-100 p-3">
                    <img src={product.image} alt={product.name} className="h-20 w-20 rounded-2xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{product.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{product.category}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-lg font-black text-slate-900">{currency(product.price)}</span>
                        <button
                          onClick={() => addToCart(product)}
                          className="rounded-full bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-900"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 flex flex-wrap gap-3">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                selectedCategory === category
                  ? 'border-amber-400 bg-amber-100 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              {category}
            </button>
          ))}
        </section>

        <section id="shop" className="mt-10 grid gap-6 xl:grid-cols-[1.4fr_0.7fr]">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Browse catalog</p>
                <h2 className="mt-2 text-3xl font-black text-slate-900">Popular picks</h2>
              </div>
              <p className="text-sm text-slate-500">{filteredProducts.length} products</p>
            </div>

            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              {filteredProducts.map((product) => (
                <article key={product.id} className="group rounded-[28px] bg-white p-3 shadow-[0_16px_45px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 transition hover:-translate-y-1">
                  <div className="relative overflow-hidden rounded-[22px]">
                    <img src={product.images?.[0]} alt={product.name} className="h-56 w-full object-cover transition duration-500 group-hover:scale-105" />
                    <button
                      onClick={() => toggleWishlist(product.id)}
                      className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full shadow-lg ${
                        wishlist.includes(product.id) ? 'bg-rose-500 text-white' : 'bg-white/80 text-slate-700'
                      }`}
                      aria-label="Toggle wishlist"
                    >
                      <Heart size={16} fill={wishlist.includes(product.id) ? 'currentColor' : 'none'} />
                    </button>
                    <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-700">
                      {product.category}
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{product.brand}</span>
                      <span className="flex items-center gap-1 font-semibold text-amber-600">
                        <Star size={12} fill="currentColor" /> {formatRating(product.rating)}
                      </span>
                    </div>

                    <button onClick={() => setSelectedProduct(product)} className="mt-3 block text-left">
                      <h3 className="text-lg font-black text-slate-900">{product.name}</h3>
                    </button>

                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">{product.description}</p>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-2xl font-black text-slate-900">{currency(product.price)}</p>
                        <p className="text-xs text-emerald-600">{product.discount}% off</p>
                      </div>

                      <button
                        onClick={() => addToCart(product)}
                        className="rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 shadow-md shadow-amber-200 transition hover:bg-amber-300"
                      >
                        Add to cart
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-[30px] bg-slate-900 p-5 text-white shadow-[0_20px_70px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Cart summary</p>
                <h3 className="mt-2 text-2xl font-black">₦{currency(totals.subtotal).replace('₦', '').replace(/, /g, '')}</h3>
              </div>
              <div className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-200">
                {cart.length} items
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {cart.length === 0 ? (
                <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4 text-sm text-slate-300">
                  Your cart is empty. Add some essentials or browse today’s deals.
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-700 bg-slate-800/70 p-3">
                    <div className="flex items-center gap-3">
                      <img src={item.images?.[0] || item.image} alt={item.name} className="h-14 w-14 rounded-xl object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-slate-400">{currency(item.price)}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-700 px-2 py-1">
                        <button onClick={() => updateCartQuantity(item.id, -1)} className="p-1 text-slate-200">
                          <Minus size={12} />
                        </button>
                        <span className="min-w-5 text-center text-sm font-semibold">{item.quantity}</span>
                        <button onClick={() => updateCartQuantity(item.id, 1)} className="p-1 text-slate-200">
                          <Plus size={12} />
                        </button>
                      </div>
                      <p className="text-sm font-bold">{currency(item.price * item.quantity)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between"><span>Subtotal</span><span>{currency(totals.subtotal)}</span></div>
              <div className="flex items-center justify-between"><span>Delivery</span><span>{currency(totals.delivery)}</span></div>
              <div className="flex items-center justify-between text-base font-bold text-white"><span>Total</span><span>{currency(totals.total)}</span></div>
            </div>

            <form onSubmit={checkoutOrder} className="mt-6 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={checkoutForm.name}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, name: event.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400"
                  placeholder="Full name"
                />
                <input
                  value={checkoutForm.phone}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, phone: event.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400"
                  placeholder="Phone"
                />
              </div>
              <input
                value={checkoutForm.email}
                onChange={(event) => setCheckoutForm({ ...checkoutForm, email: event.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400"
                placeholder="Email"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={checkoutForm.state}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, state: event.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400"
                  placeholder="State"
                />
                <input
                  value={checkoutForm.city}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, city: event.target.value })}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400"
                  placeholder="City"
                />
              </div>
              <input
                value={checkoutForm.street}
                onChange={(event) => setCheckoutForm({ ...checkoutForm, street: event.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-400"
                placeholder="Street address"
              />
              <select
                value={checkoutForm.delivery}
                onChange={(event) => setCheckoutForm({ ...checkoutForm, delivery: event.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
              >
                {deliveryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} · {currency(option.fee)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!cart.length}
                className="w-full rounded-full bg-amber-400 px-4 py-3 text-sm font-black text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {auth ? 'Secure checkout' : 'Checkout as guest'}
              </button>
            </form>
          </aside>
        </section>

        <section id="deals" className="mt-14 grid gap-5 lg:grid-cols-3">
          {[
            { icon: <Truck size={20} />, title: 'Fast delivery', detail: 'Standard, express, and pickup options across Nigeria.' },
            { icon: <ShieldCheck size={20} />, title: 'Secure payments', detail: 'Paystack-ready and DEMO mode when credentials are unavailable.' },
            { icon: <Check size={20} />, title: 'Verified quality', detail: 'Only reviewed products with clear stock and price snapshots.' },
          ].map((item) => (
            <div key={item.title} className="rounded-[28px] bg-white p-5 shadow-[0_12px_45px_rgba(15,23,42,0.05)] ring-1 ring-slate-100">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">{item.icon}</div>
              <h3 className="mt-4 text-xl font-black text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
            </div>
          ))}
        </section>

        <section className="mt-14 rounded-[30px] bg-white p-6 shadow-[0_16px_45px_rgba(15,23,42,0.03)] ring-1 ring-slate-100">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">AI recommendations</p>
              <h3 className="mt-2 text-3xl font-black text-slate-900">Built for your shopping style</h3>
            </div>
            <button onClick={() => setAiOpen(true)} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Open assistant <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {recommendations.map((product) => (
              <div key={product.id} className="rounded-[26px] border border-slate-100 p-3">
                <img src={product.image} alt={product.name} className="h-48 w-full rounded-[20px] object-cover" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-slate-900">{product.name}</p>
                    <p className="text-sm text-slate-500">{product.category}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">{formatRating(product.rating)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xl font-black">{currency(product.price)}</span>
                  <button onClick={() => addToCart(product)} className="rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="orders" className="mt-14 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[30px] bg-white p-6 shadow-[0_16px_45px_rgba(15,23,42,0.03)] ring-1 ring-slate-100">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Order timeline</p>
            <h3 className="mt-2 text-3xl font-black text-slate-900">Track your order</h3>
            <div className="mt-6 space-y-4">
              {[{ title: 'Order confirmed', active: true }, { title: 'Packed', active: true }, { title: 'In transit', active: false }, { title: 'Delivered', active: false }].map((step, index) => (
                <div key={step.title} className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${step.active ? 'bg-amber-400 text-slate-900' : 'bg-slate-100 text-slate-500'}`}>
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{step.title}</p>
                    <p className="text-sm text-slate-500">{step.active ? 'Completed today' : 'Next step'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] bg-gradient-to-br from-amber-400 to-yellow-200 p-6 text-slate-900 shadow-[0_16px_45px_rgba(251,191,36,0.15)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">Operations</p>
            <h3 className="mt-3 text-3xl font-black">Business overview</h3>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="text-sm text-slate-700">Revenue</p>
                <p className="mt-2 text-2xl font-black">{currency(analytics.revenue || 0)}</p>
              </div>
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="text-sm text-slate-700">Orders</p>
                <p className="mt-2 text-2xl font-black">{analytics.orders || 0}</p>
              </div>
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="text-sm text-slate-700">Customers</p>
                <p className="mt-2 text-2xl font-black">{analytics.customers || 0}</p>
              </div>
              <div className="rounded-2xl bg-white/60 p-3">
                <p className="text-sm text-slate-700">Low stock</p>
                <p className="mt-2 text-2xl font-black">{analytics.lowStock || 0}</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[30px] bg-white p-4 shadow-2xl sm:p-6">
            <button onClick={() => setSelectedProduct(null)} className="absolute right-4 top-4 rounded-full bg-slate-100 p-2 text-slate-600">
              <X size={18} />
            </button>
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <img src={selectedProduct.images?.[0]} alt={selectedProduct.name} className="h-[420px] w-full rounded-[26px] object-cover" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">{selectedProduct.category}</p>
                <h3 className="mt-3 text-3xl font-black text-slate-900">{selectedProduct.name}</h3>
                <p className="mt-2 text-sm text-slate-500">by {selectedProduct.brand}</p>

                <div className="mt-4 flex items-center gap-2 text-amber-600">
                  <Star size={18} fill="currentColor" />
                  <span className="font-bold">{formatRating(selectedProduct.rating)}</span>
                  <span className="text-sm text-slate-500">({selectedProduct.reviewCount} reviews)</span>
                </div>

                <div className="mt-5 flex items-center gap-3">
                  <span className="text-4xl font-black text-slate-900">{currency(selectedProduct.price)}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">{selectedProduct.discount}% off</span>
                </div>

                <p className="mt-5 text-slate-600">{selectedProduct.description}</p>

                <div className="mt-5 flex items-center gap-4">
                  <button onClick={() => addToCart(selectedProduct)} className="rounded-full bg-amber-400 px-5 py-3 font-bold text-slate-900">
                    Add to cart
                  </button>
                  <button onClick={() => toggleWishlist(selectedProduct.id)} className="rounded-full border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700">
                    {wishlist.includes(selectedProduct.id) ? 'Saved' : 'Save for later'}
                  </button>
                </div>

                <div className="mt-7 rounded-[22px] bg-slate-50 p-4">
                  <h4 className="text-lg font-black text-slate-900">Specifications</h4>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {Object.entries(selectedProduct.specifications || {}).map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{key}</p>
                        <p className="mt-1 font-semibold text-slate-800">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {aiOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[420px] rounded-[30px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.18)] ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Sparkles size={16} />
              </div>
              <div>
                <p className="text-sm font-black text-slate-900">BUO AI</p>
                <p className="text-[10px] text-slate-500">
                  {serviceStatus.database === 'postgresql' && serviceStatus.gemini === 'configured'
                    ? 'Live catalog • Gemini'
                    : 'Setup required'}
                </p>
              </div>
            </div>
            <button onClick={() => setAiOpen(false)} className="rounded-full bg-slate-100 p-2 text-slate-600">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3 p-4">
            {aiMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${message.role === 'assistant' ? 'bg-amber-50 text-slate-800' : 'ml-auto bg-slate-900 text-white'}`}>
                <p>{message.text}</p>
                {message.products?.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.products.map((product) => (
                      <button
                        key={product.id}
                        onClick={() => {
                          const match = catalog.find((item) => item.id === product.id)
                          setSelectedProduct(match || product)
                        }}
                        className="flex w-full items-center gap-2 rounded-xl bg-white p-2 text-left ring-1 ring-amber-100"
                      >
                        <img src={product.images?.[0]} alt={product.name} className="h-10 w-10 rounded-lg object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">{product.name}</span>
                          <span className="block text-xs">{currency(product.price)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {aiLoading && (
              <div role="status" className="max-w-[80%] rounded-2xl bg-amber-50 px-3 py-2 text-sm text-slate-500">
                Searching the BUO catalog…
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {['Budget phone under ₦500,000', 'Smart TV for my apartment', 'Best laptop for work'].map((prompt) => (
                <button key={prompt} onClick={() => setAiInput(prompt)} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={aiInput}
                onChange={(event) => setAiInput(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && sendAiPrompt()}
                placeholder="Ask BUO AI..."
                className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-amber-300"
              />
              <button onClick={sendAiPrompt} disabled={aiLoading} className="rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-slate-900 disabled:opacity-50">
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {guestOrder && (
        <div className="fixed bottom-6 left-6 z-50 max-w-md rounded-[26px] bg-slate-900 p-5 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Order placed</p>
              <h4 className="mt-2 text-xl font-black">{guestOrder.id}</h4>
            </div>
            <button onClick={() => setGuestOrder(null)} className="rounded-full bg-slate-700 p-2">
              <X size={14} />
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            {guestOrder.mode === 'DEMO_PREVIEW'
              ? 'DEMO preview only. No server-side order or payment was created.'
              : 'DEMO payment mode: no money was collected. The order is saved as pending until payment is integrated.'}
          </p>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-800 p-3 text-sm">
            <span>Status</span>
            <span className="rounded-full bg-amber-400 px-2 py-1 text-xs font-bold text-slate-900">{guestOrder.status}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
