import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
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
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
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
  const [aiStatusStage, setAiStatusStage] = useState('')
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
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchTerm])

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
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (selectedCategory !== 'All') params.set('category', selectedCategory)
      params.set('limit', '12')

      setCatalogLoading(true)
      setCatalogError('')
      try {
        const res = await fetch(apiUrl(`/api/products?${params.toString()}`))
        if (!res.ok) throw new Error('The product catalog is temporarily unavailable.')
        const data = await res.json()
        setCatalog(data?.data || [])
      } catch (error) {
        setCatalog([])
        setCatalogError(error.message || 'The product catalog is temporarily unavailable.')
      } finally {
        setCatalogLoading(false)
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
  }, [debouncedSearch, selectedCategory])

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
    setAiStatusStage('Understanding your shopping request…')

    const timer1 = setTimeout(() => {
      setAiStatusStage('Searching BUO catalog in PostgreSQL…')
    }, 1500)

    const timer2 = setTimeout(() => {
      setAiStatusStage('Selecting recommendations for you…')
    }, 3500)

    try {
      const cartCategories = [...new Set(cart.map((item) => item.category).filter(Boolean))]
      const response = await fetch(apiUrl(`/api/ai/conversations/${aiConversationId}/messages`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          context: {
            cartCategories,
            cartCount: cart.reduce((total, item) => total + item.quantity, 0),
          },
        }),
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
      clearTimeout(timer1)
      clearTimeout(timer2)
      setAiLoading(false)
      setAiStatusStage('')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#" className="flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-black text-white shadow-lg shadow-indigo-600/20">
              B
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-zinc-950">BUO</p>
              <p className="text-xs text-zinc-500">Nigerian marketplace</p>
            </div>
          </a>

          <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-600 lg:flex">
            <a href="#shop" className="transition-colors hover:text-indigo-600">Shop</a>
            <a href="#deals" className="transition-colors hover:text-indigo-600">Why BUO</a>
            <a href="#ai" className="transition-colors hover:text-indigo-600">AI shopping</a>
            <a href="#orders" className="transition-colors hover:text-indigo-600">Orders</a>
          </nav>

          <div className="flex items-center gap-3">
            <label className="hidden h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600 transition focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-500/10 md:flex">
              <Search size={16} className="shrink-0 text-zinc-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search the store"
                aria-label="Search products"
                className="w-36 bg-transparent outline-none placeholder:text-zinc-400 lg:w-44"
              />
            </label>
            <button
              onClick={loginDemo}
              className="inline-flex min-h-10 items-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/15 sm:px-4 sm:text-sm"
            >
              {auth ? `Hi, ${auth.name.split(' ')[0]}` : 'Login'}
            </button>
            <a href="#cart" aria-label={`Cart, ${cart.length} items`} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-zinc-950 px-3.5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 active:scale-[0.98] sm:px-4">
              <ShoppingBag size={16} />
              <span className="hidden sm:inline">Cart</span>
              <span className="flex h-5 min-w-5 items-center justify-center rounded-md bg-white/15 px-1 text-xs">{cart.length}</span>
            </a>
          </div>
        </div>
        <div className="px-4 pb-3 sm:px-6 md:hidden">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600 focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-indigo-500/10">
            <Search size={16} className="shrink-0 text-zinc-400" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search the store"
              aria-label="Search products"
              className="w-full bg-transparent outline-none placeholder:text-zinc-400"
            />
          </label>
        </div>
      </header>

      {notice && (
        <div role="status" className="mx-4 mt-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-auto sm:max-w-7xl">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss notification" className="ml-4 rounded-lg p-2 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
            <X size={16} />
          </button>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-10">
        <section className="relative isolate overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-28 -z-10 h-96 w-96 rounded-full bg-indigo-100/80 blur-3xl" />
          <div className="grid items-center gap-8 p-6 sm:p-9 lg:grid-cols-[1.15fr_0.85fr] lg:p-12">
            <div className="py-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                <Sparkles size={13} />
                A better way to shop local
              </span>
              <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight text-zinc-950 sm:text-5xl lg:text-6xl">
                Discover products your life deserves.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600 sm:text-lg">
                From Lagos to Port Harcourt, find everyday essentials, discover great deals, and shop with confidence.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="#shop"
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-indigo-600 px-5 font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25 active:scale-[0.98]"
                >
                  Shop now <ArrowRight size={16} />
                </a>
                <button
                  onClick={() => setAiOpen(true)}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/15 active:scale-[0.98]"
                >
                  <MessageSquareText size={16} />
                  Ask BUO AI
                </button>
              </div>
              <div className="mt-9 flex flex-wrap gap-x-8 gap-y-4 border-t border-zinc-200 pt-6">
                <div>
                  <p className="text-xl font-semibold tracking-tight text-zinc-950">30k+</p>
                  <p className="mt-1 text-sm text-zinc-500">happy shoppers</p>
                </div>
                <div>
                  <p className="text-xl font-semibold tracking-tight text-zinc-950">7 days</p>
                  <p className="mt-1 text-sm text-zinc-500">delivery support</p>
                </div>
                <div>
                  <p className="text-xl font-semibold tracking-tight text-zinc-950">4.9/5</p>
                  <p className="mt-1 text-sm text-zinc-500">customer rating</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900">Today’s picks</p>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  Up to 30% off
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {recommendations.slice(0, 3).map((product) => (
                  <div key={product.id} className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-zinc-300 hover:shadow-sm">
                    <img src={product.image} alt={product.name} className="h-16 w-16 rounded-lg bg-zinc-100 object-cover sm:h-20 sm:w-20" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-900">{product.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{product.category}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-base font-semibold text-zinc-950">{currency(product.price)}</span>
                        <button
                          onClick={() => addToCart(product)}
                          className="min-h-9 rounded-lg bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-[0.97]"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {recommendations.length === 0 && (
                  <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-5 text-center">
                    <Sparkles size={20} className="text-indigo-500" />
                    <p className="mt-3 text-sm font-medium text-zinc-800">Good finds are on the way</p>
                    <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">Our curated picks will appear here when the product catalog is connected.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section aria-label="Product categories" className="mt-8 flex gap-2 overflow-x-auto pb-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`min-h-10 shrink-0 rounded-xl border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/15 ${
                selectedCategory === category
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950'
              }`}
            >
              {category}
            </button>
          ))}
        </section>

        <section id="shop" className="mt-7 grid scroll-mt-24 gap-7 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-indigo-600">The BUO edit</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Popular picks</h2>
              </div>
              <p className="text-sm text-zinc-500">
                {catalogLoading ? 'Finding products…' : `${filteredProducts.length} ${filteredProducts.length === 1 ? 'product' : 'products'}`}
              </p>
            </div>

            {catalogError && !catalogLoading ? (
              <div role="status" className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
                  <ShoppingBag size={21} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-zinc-900">The catalog is taking a break</h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">{catalogError} The storefront preview is live, but product data needs the backend.</p>
              </div>
            ) : catalogLoading ? (
              <div aria-label="Loading products" aria-busy="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-3">
                    <div className="aspect-[4/3] animate-pulse rounded-xl bg-zinc-200" />
                    <div className="mt-4 h-3 w-1/3 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-3 h-5 w-4/5 animate-pulse rounded bg-zinc-200" />
                    <div className="mt-2 h-3 w-full animate-pulse rounded bg-zinc-100" />
                    <div className="mt-5 flex items-center justify-between">
                      <div className="h-6 w-24 animate-pulse rounded bg-zinc-200" />
                      <div className="h-10 w-24 animate-pulse rounded-xl bg-zinc-200" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500">
                  <Search size={20} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-zinc-900">No products found</h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">Try another search or choose a different category to keep exploring.</p>
                <button
                  onClick={() => { setSearchTerm(''); setSelectedCategory('All') }}
                  className="mt-4 min-h-10 rounded-xl px-4 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/15"
                >
                  Clear filters
                </button>
              </div>
            ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filteredProducts.map((product) => (
                <article key={product.id} className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white p-3 transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-xl">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-zinc-100">
                    <img src={product.images?.[0] || product.image} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                    <button
                      onClick={() => toggleWishlist(product.id)}
                      className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/70 shadow-sm backdrop-blur transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25 active:scale-95 ${
                        wishlist.includes(product.id) ? 'bg-rose-500 text-white' : 'bg-white/90 text-zinc-700 hover:text-rose-500'
                      }`}
                      aria-label={wishlist.includes(product.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                    >
                      <Heart size={16} fill={wishlist.includes(product.id) ? 'currentColor' : 'none'} />
                    </button>
                    <span className="absolute left-3 top-3 rounded-lg border border-white/60 bg-white/90 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700 backdrop-blur">
                      {product.category}
                    </span>
                  </div>

                  <div className="px-1 pb-1 pt-4">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>{product.brand}</span>
                      <span className="flex items-center gap-1 font-medium text-zinc-700">
                        <Star size={12} fill="currentColor" /> {formatRating(product.rating)}
                      </span>
                    </div>

                    <button onClick={() => setSelectedProduct(product)} className="mt-2 block min-h-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                      <h3 className="line-clamp-2 text-base font-semibold leading-6 text-zinc-900">{product.name}</h3>
                    </button>

                    <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-500">{product.description}</p>

                    <div className="mt-4 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold tracking-tight text-zinc-950">{currency(product.price)}</p>
                        {product.discount > 0 && <p className="mt-0.5 text-xs font-medium text-emerald-700">{product.discount}% off</p>}
                      </div>

                      <button
                        onClick={() => addToCart(product)}
                        className="min-h-10 shrink-0 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25 active:scale-95"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            )}
          </div>

          <aside id="cart" className="scroll-mt-24 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm 2xl:sticky 2xl:top-24 2xl:self-start">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-500">Your cart</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{currency(totals.subtotal)}</h3>
              </div>
              <div className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold text-zinc-600">
                {cart.reduce((total, item) => total + item.quantity, 0)} items
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {cart.length === 0 ? (
                <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 text-center">
                  <ShoppingBag size={20} className="text-zinc-400" />
                  <p className="mt-3 text-sm font-medium text-zinc-800">Your cart is empty</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">Add something you love and it’ll show up here.</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="flex items-center gap-3">
                      <img src={item.images?.[0] || item.image} alt={item.name} className="h-14 w-14 rounded-lg bg-zinc-100 object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-900">{item.name}</p>
                        <p className="text-xs text-zinc-500">{currency(item.price)}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1">
                        <button onClick={() => updateCartQuantity(item.id, -1)} aria-label={`Decrease ${item.name} quantity`} className="rounded p-1 text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                          <Minus size={12} />
                        </button>
                        <span className="min-w-5 text-center text-sm font-medium text-zinc-800">{item.quantity}</span>
                        <button onClick={() => updateCartQuantity(item.id, 1)} aria-label={`Increase ${item.name} quantity`} className="rounded p-1 text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                          <Plus size={12} />
                        </button>
                      </div>
                      <p className="text-sm font-semibold text-zinc-900">{currency(item.price * item.quantity)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 space-y-3 border-t border-zinc-200 pt-4 text-sm text-zinc-500">
              <div className="flex items-center justify-between"><span>Subtotal</span><span className="text-zinc-800">{currency(totals.subtotal)}</span></div>
              <div className="flex items-center justify-between"><span>Delivery</span><span className="text-zinc-800">{currency(totals.delivery)}</span></div>
              <div className="flex items-center justify-between border-t border-zinc-200 pt-3 text-base font-semibold text-zinc-950"><span>Total</span><span>{currency(totals.total)}</span></div>
            </div>

            <form onSubmit={checkoutOrder} className="mt-6 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={checkoutForm.name}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, name: event.target.value })}
                  className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="Full name"
                />
                <input
                  value={checkoutForm.phone}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, phone: event.target.value })}
                  className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="Phone"
                />
              </div>
              <input
                value={checkoutForm.email}
                onChange={(event) => setCheckoutForm({ ...checkoutForm, email: event.target.value })}
                className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                placeholder="Email"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={checkoutForm.state}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, state: event.target.value })}
                  className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="State"
                />
                <input
                  value={checkoutForm.city}
                  onChange={(event) => setCheckoutForm({ ...checkoutForm, city: event.target.value })}
                  className="min-h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                  placeholder="City"
                />
              </div>
              <input
                value={checkoutForm.street}
                onChange={(event) => setCheckoutForm({ ...checkoutForm, street: event.target.value })}
                className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                placeholder="Street address"
              />
              <select
                value={checkoutForm.delivery}
                onChange={(event) => setCheckoutForm({ ...checkoutForm, delivery: event.target.value })}
                className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
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
                className="min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {auth ? 'Secure checkout' : 'Checkout as guest'}
              </button>
            </form>
          </aside>
        </section>

        <section id="deals" className="mt-16 grid scroll-mt-24 gap-4 lg:grid-cols-3">
          {[
            { icon: <Truck size={20} />, title: 'Fast delivery', detail: 'Standard, express, and pickup options across Nigeria.' },
            { icon: <ShieldCheck size={20} />, title: 'Secure payments', detail: 'Paystack-ready and DEMO mode when credentials are unavailable.' },
            { icon: <Check size={20} />, title: 'Verified quality', detail: 'Only reviewed products with clear stock and price snapshots.' },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">{item.icon}</div>
              <h3 className="mt-4 text-base font-semibold text-zinc-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{item.detail}</p>
            </div>
          ))}
        </section>

        <section id="ai" className="mt-16 scroll-mt-24 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-indigo-600">AI recommendations</p>
              <h3 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">Built for your shopping style</h3>
            </div>
            <button onClick={() => setAiOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 active:scale-[0.98]">
              Open assistant <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {recommendations.map((product) => (
              <div key={product.id} className="rounded-2xl border border-zinc-200 p-3 transition hover:shadow-md">
                <img src={product.image} alt={product.name} className="aspect-[4/3] w-full rounded-xl bg-zinc-100 object-cover" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-zinc-900">{product.name}</p>
                    <p className="text-sm text-zinc-500">{product.category}</p>
                  </div>
                  <span className="rounded-lg bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">{formatRating(product.rating)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-semibold text-zinc-950">{currency(product.price)}</span>
                  <button onClick={() => addToCart(product)} className="min-h-10 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 active:scale-95">
                    Add
                  </button>
                </div>
              </div>
            ))}
            {recommendations.length === 0 && (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 text-center md:col-span-3">
                <Sparkles size={20} className="text-indigo-500" />
                <p className="mt-3 text-sm font-medium text-zinc-800">Recommendations will appear here</p>
                <p className="mt-1 text-sm text-zinc-500">Connect the BUO catalog to discover picks tailored to you.</p>
              </div>
            )}
          </div>
        </section>

        <section id="orders" className="mt-16 grid scroll-mt-24 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm font-medium text-indigo-600">Order timeline</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">Track your order</h3>
            <div className="mt-6 space-y-4">
              {[{ title: 'Order confirmed', active: true }, { title: 'Packed', active: true }, { title: 'In transit', active: false }, { title: 'Delivered', active: false }].map((step, index) => (
                <div key={step.title} className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold ${step.active ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                    {index + 1}
                  </div>
                  <div>
                    <p className="font-medium text-zinc-900">{step.title}</p>
                    <p className="text-sm text-zinc-500">{step.active ? 'Completed today' : 'Next step'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm font-medium text-indigo-600">Operations</p>
            <h3 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">Business overview</h3>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">Revenue</p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">{currency(analytics.revenue || 0)}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">Orders</p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">{analytics.orders || 0}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">Customers</p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">{analytics.customers || 0}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-3">
                <p className="text-sm text-zinc-500">Low stock</p>
                <p className="mt-2 text-xl font-semibold text-zinc-950">{analytics.lowStock || 0}</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {selectedProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-3 backdrop-blur-sm sm:p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              className="relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl sm:p-6"
            >
              <button onClick={() => setSelectedProduct(null)} aria-label="Close product details" className="absolute right-4 top-4 z-10 rounded-xl bg-white p-2 text-zinc-600 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20">
                <X size={18} />
              </button>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <img src={selectedProduct.images?.[0] || selectedProduct.image} alt={selectedProduct.name} className="aspect-square w-full rounded-xl bg-zinc-100 object-cover" />
                </div>
                <div>
                  <p className="text-sm font-medium text-indigo-600">{selectedProduct.category}</p>
                  <h3 className="mt-2 pr-10 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">{selectedProduct.name}</h3>
                  <p className="mt-2 text-sm text-zinc-500">by {selectedProduct.brand}</p>

                  <div className="mt-4 flex items-center gap-2 text-zinc-700">
                    <Star size={18} fill="currentColor" />
                    <span className="font-semibold">{formatRating(selectedProduct.rating)}</span>
                    <span className="text-sm text-zinc-500">({selectedProduct.reviewCount} reviews)</span>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <span className="text-3xl font-semibold tracking-tight text-zinc-950">{currency(selectedProduct.price)}</span>
                    {selectedProduct.discount > 0 && <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">{selectedProduct.discount}% off</span>}
                  </div>

                  <p className="mt-5 leading-7 text-zinc-600">{selectedProduct.description}</p>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button onClick={() => addToCart(selectedProduct)} className="min-h-11 rounded-xl bg-indigo-600 px-5 font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 active:scale-95">
                      Add to cart
                    </button>
                    <button onClick={() => toggleWishlist(selectedProduct.id)} className="min-h-11 rounded-xl border border-zinc-200 bg-white px-5 font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/15 active:scale-95">
                      {wishlist.includes(selectedProduct.id) ? 'Saved' : 'Save for later'}
                    </button>
                  </div>

                  <div className="mt-7 rounded-xl bg-zinc-50 p-4">
                    <h4 className="text-base font-semibold text-zinc-900">Specifications</h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {Object.entries(selectedProduct.specifications || {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg border border-zinc-200 bg-white p-3">
                          <p className="text-xs uppercase tracking-[0.12em] text-zinc-500">{key}</p>
                          <p className="mt-1 font-medium text-zinc-800">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {aiOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
            className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(680px,85vh)] flex-col overflow-hidden rounded-2xl border border-white/40 bg-white/90 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[420px]"
          >
            <div className="flex items-center justify-between border-b border-zinc-200/80 px-4 py-3 bg-white/50 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Sparkles size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-950">BUO AI</p>
                  <p className="text-xs text-zinc-500">
                    {serviceStatus.database === 'postgresql' && serviceStatus.gemini === 'configured'
                      ? 'Live catalog • Gemini'
                      : 'Setup required'}
                  </p>
                </div>
              </div>
              <button onClick={() => setAiOpen(false)} aria-label="Close BUO AI" className="rounded-lg bg-zinc-100 p-2 text-zinc-600 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <X size={14} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {aiMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-6 ${message.role === 'assistant' ? 'bg-zinc-100/90 text-zinc-800' : 'ml-auto bg-indigo-600 text-white'}`}>
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
                          className="flex w-full items-center gap-2 rounded-xl bg-white p-2 text-left ring-1 ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-[0.98]"
                        >
                          <img src={product.images?.[0] || product.image} alt={product.name} className="h-10 w-10 rounded-lg bg-zinc-100 object-cover" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-zinc-900">{product.name}</span>
                            <span className="block text-xs text-zinc-500">{currency(product.price)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {aiLoading && (
                <div role="status" className="flex max-w-[85%] items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/90 px-3.5 py-2.5 text-xs font-medium text-indigo-700 shadow-sm">
                  <Sparkles size={14} className="shrink-0 animate-spin text-indigo-600" />
                  <span>{aiStatusStage || 'Searching the BUO catalog…'}</span>
                </div>
              )}
            </div>

            <div className="border-t border-zinc-200/80 p-3 bg-white/40">
              <div className="mb-3 flex flex-wrap gap-2">
                {['Budget phone under ₦500,000', 'Smart TV for my apartment', 'Best laptop for work'].map((prompt) => (
                  <button key={prompt} onClick={() => setAiInput(prompt)} className="min-h-8 rounded-lg bg-zinc-100/90 px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95">
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
                  className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
                />
                <button onClick={sendAiPrompt} disabled={aiLoading} className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
                  Send
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {guestOrder && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-2xl sm:bottom-6 sm:left-6 sm:right-auto"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Order placed</p>
                <h4 className="mt-2 text-xl font-semibold">{guestOrder.id}</h4>
              </div>
              <button onClick={() => setGuestOrder(null)} aria-label="Dismiss order confirmation" className="rounded-lg bg-zinc-100 p-2 text-zinc-600 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <X size={14} />
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              {guestOrder.mode === 'DEMO_PREVIEW'
                ? 'DEMO preview only. No server-side order or payment was created.'
                : 'DEMO payment mode: no money was collected. The order is saved as pending until payment is integrated.'}
            </p>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-zinc-100 p-3 text-sm">
              <span>Status</span>
              <span className="rounded-lg bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-800">{guestOrder.status}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
