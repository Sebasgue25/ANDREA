const STORAGE_KEY = 'andrea-pedidos-data-v1';
const products = ['Camiseta', 'Pantalón', 'Conjunto de calentador', 'Suéter de lana'];
const statuses = ['Nuevo', 'Confirmado', 'En corte', 'En confección', 'Terminado', 'Entregado'];

let state = loadState();
let currentItems = [];
let deferredInstallPrompt = null;
let supabaseClient = null;
let currentUser = null;
let realtimeChannel = null;
let cloudRefreshTimer = null;

function hasCloudConfiguration() {
  const config = window.ANDREA_SUPABASE_CONFIG;
  return Boolean(config?.url && config?.anonKey && window.supabase?.createClient);
}

function setSyncStatus(label, cloud = false) {
  const status = document.getElementById('sync-status');
  const storage = document.getElementById('storage-mode');
  if (!status || !storage) return;
  status.textContent = label;
  status.classList.toggle('cloud', cloud);
  storage.textContent = cloud ? 'Pedidos sincronizados con Supabase' : 'Datos guardados en este dispositivo';
}

function showAuthScreen(message = '') {
  const screen = document.getElementById('auth-screen');
  const error = document.getElementById('auth-error');
  screen.hidden = false;
  error.hidden = !message;
  error.textContent = message;
}

function hideAuthScreen() {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('auth-error').hidden = true;
}

function normaliseRemoteOrder(order) {
  return {
    id: order.id,
    sequence: Number(order.sequence),
    number: order.number,
    createdAt: order.created_at,
    customerName: order.customer_name,
    customerPhone: order.customer_phone || '',
    deliveryDate: order.delivery_date,
    type: order.order_type,
    items: order.items || [],
    embroidery: order.embroidery || null,
    deposit: Number(order.deposit || 0),
    notes: order.notes || '',
    status: order.status,
    subtotal: Number(order.subtotal || 0),
    total: Number(order.total || 0)
  };
}

function normaliseRemoteInventory(item) {
  return { id: item.id, product: item.product, color: item.color, size: item.size, quantity: Number(item.quantity), price: Number(item.price) };
}

async function refreshRemoteState() {
  if (!supabaseClient || !currentUser) return;
  setSyncStatus('Sincronizando…', true);
  const [ordersResult, inventoryResult] = await Promise.all([
    supabaseClient.from('orders').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('inventory').select('*').order('product', { ascending: true })
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (inventoryResult.error) throw inventoryResult.error;
  state.orders = ordersResult.data.map(normaliseRemoteOrder);
  state.inventory = inventoryResult.data.map(normaliseRemoteInventory);
  persist();
  render();
  setSyncStatus('Sincronizado', true);
}

function subscribeToCloudChanges() {
  if (!supabaseClient || realtimeChannel) return;
  realtimeChannel = supabaseClient.channel('andrea-pedidos-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleCloudRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, scheduleCloudRefresh)
    .subscribe();
}

function scheduleCloudRefresh() {
  clearTimeout(cloudRefreshTimer);
  cloudRefreshTimer = setTimeout(() => refreshRemoteState().catch(() => setSyncStatus('Sin conexión', true)), 300);
}

async function enterCloudMode(session) {
  currentUser = session.user;
  document.getElementById('profile-button').textContent = (currentUser.email || 'A').slice(0, 1).toUpperCase();
  document.getElementById('profile-button').title = `Cerrar sesión (${currentUser.email || 'usuario'})`;
  hideAuthScreen();
  try {
    await refreshRemoteState();
    subscribeToCloudChanges();
  } catch (error) {
    setSyncStatus('Error de conexión', true);
    showAuthScreen(`No se pudieron cargar los datos: ${error.message}`);
  }
}

async function signIn(event) {
  event.preventDefault();
  const error = document.getElementById('auth-error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Ingresando…';
  const { data, error: signInError } = await supabaseClient.auth.signInWithPassword({
    email: document.getElementById('auth-email').value.trim(),
    password: document.getElementById('auth-password').value
  });
  button.disabled = false;
  button.textContent = 'Ingresar';
  if (signInError || !data.session) {
    error.textContent = signInError?.message || 'No se pudo iniciar sesión.';
    error.hidden = false;
    return;
  }
  event.currentTarget.reset();
  await enterCloudMode(data.session);
}

async function signOut() {
  if (!supabaseClient || !currentUser) return showToast('Esta versión está funcionando en modo local.');
  await supabaseClient.auth.signOut();
  currentUser = null;
  if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  setSyncStatus('Sin sesión', true);
  showAuthScreen();
}

async function initSupabase() {
  if (!hasCloudConfiguration()) return; // Sin config.js completo: se queda en modo local, como antes.
  const config = window.ANDREA_SUPABASE_CONFIG;
  supabaseClient = window.supabase.createClient(config.url, config.anonKey);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      enterCloudMode(session);
    } else {
      currentUser = null;
      if (realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
      setSyncStatus('Sin sesión', true);
      showAuthScreen();
    }
  });

  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    await enterCloudMode(data.session);
  } else {
    showAuthScreen();
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.orders) && Array.isArray(saved.inventory)) return saved;
  } catch (_) {}
  return { orders: [], inventory: [] };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function todayISO() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function orderNumber() {
  const max = state.orders.reduce((highest, order) => Math.max(highest, Number(order.sequence || 0)), 0);
  return max + 1;
}

function orderLabel(sequence) {
  return `PED-${String(sequence).padStart(4, '0')}`;
}

function setToday() {
  document.getElementById('today').textContent = new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { toast.hidden = true; }, 3600);
}

function goTo(view) {
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active-view', element.id === view));
  document.querySelectorAll('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const labels = { inicio: ['GESTIÓN DE TALLER', 'Buenos días'], pedido: ['NUEVO REGISTRO', 'Crear pedido'], pedidos: ['REGISTRO', 'Pedidos'], inventario: ['PRODUCTO TERMINADO', 'Inventario'], proformas: ['DOCUMENTOS', 'Proformas y recibos'] };
  document.getElementById('page-kicker').textContent = labels[view][0];
  document.getElementById('page-title').textContent = labels[view][1];
  document.querySelector('.sidebar').classList.remove('open');
  if (view === 'pedido' && currentItems.length === 0) addItem();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addItem(item = {}) {
  currentItems.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    product: item.product || 'Camiseta',
    color: item.color || '',
    size: item.size || '',
    quantity: item.quantity || 1,
    price: item.price || 0
  });
  renderOrderItems();
}

function renderOrderItems() {
  const container = document.getElementById('order-items');
  const empty = document.getElementById('empty-items');
  container.innerHTML = currentItems.map(item => `
    <div class="order-item" data-item-id="${item.id}">
      <label class="item-product">Prenda<select data-field="product">${products.map(product => `<option ${product === item.product ? 'selected' : ''}>${product}</option>`).join('')}</select></label>
      <label>Color<input data-field="color" value="${escapeHtml(item.color)}" placeholder="Color" /></label>
      <label>Talla<input data-field="size" value="${escapeHtml(item.size)}" placeholder="Talla" /></label>
      <label>Cant.<input data-field="quantity" type="number" min="1" value="${item.quantity}" inputmode="numeric" /></label>
      <label>Precio u.<input data-field="price" type="number" min="0" step="0.01" value="${item.price}" inputmode="decimal" /></label>
      <button class="remove-item" type="button" title="Quitar prenda" aria-label="Quitar prenda">×</button>
    </div>`).join('');
  empty.hidden = currentItems.length > 0;
  renderSummary();
}

function itemSubtotal() {
  return currentItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0);
}

function embroideryPrice() {
  return document.getElementById('has-embroidery').checked ? Number(document.getElementById('embroidery-price').value || 0) : 0;
}

function renderSummary() {
  const lines = document.getElementById('summary-lines');
  const subtotal = itemSubtotal();
  const embroidery = embroideryPrice();
  lines.innerHTML = currentItems.length ? currentItems.map(item => `<div class="summary-item"><span>${escapeHtml(item.product)} · ${item.quantity} und.</span><strong>${money(Number(item.quantity) * Number(item.price))}</strong></div>`).join('') : '<p class="subtle">Aún no hay prendas.</p>';
  document.getElementById('subtotal-value').textContent = money(subtotal);
  document.getElementById('embroidery-value').textContent = money(embroidery);
  document.getElementById('total-value').textContent = money(subtotal + embroidery);
}

function renderDashboard() {
  const active = state.orders.filter(order => order.status !== 'Entregado');
  const weekLimit = new Date();
  weekLimit.setDate(weekLimit.getDate() + 7);
  const due = active.filter(order => {
    const date = new Date(`${order.deliveryDate}T12:00:00`);
    return date >= new Date(new Date().setHours(0, 0, 0, 0)) && date <= weekLimit;
  });
  const pending = active.reduce((sum, order) => sum + Math.max(0, order.total - order.deposit), 0);
  document.getElementById('active-orders').textContent = active.length;
  document.getElementById('week-orders').textContent = due.length;
  document.getElementById('pending-balance').textContent = money(pending);
  const recent = state.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  document.getElementById('recent-orders').innerHTML = recent.length ? recent.map(order => `
    <tr><td class="customer-cell"><strong>${escapeHtml(order.customerName)}</strong><small>${order.number}</small></td><td>${order.items.reduce((sum, item) => sum + item.quantity, 0)} prenda${order.items.reduce((sum, item) => sum + item.quantity, 0) !== 1 ? 's' : ''}</td><td>${formatDate(order.deliveryDate)}</td><td><span class="status-pill" data-status="${order.status}">${order.status}</span></td><td>${money(order.total)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">Aún no hay pedidos. Registra el primero desde “Nuevo pedido”.</td></tr>';
}

function renderOrders() {
  const query = (document.getElementById('order-search').value || '').trim().toLowerCase();
  const filter = document.getElementById('status-filter').value;
  const orders = state.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter(order => {
    const haystack = `${order.number} ${order.customerName} ${order.customerPhone}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!filter || order.status === filter);
  });
  document.getElementById('orders-list').innerHTML = orders.length ? orders.map(order => `
    <tr><td><strong>${order.number}</strong></td><td class="customer-cell"><strong>${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.customerPhone || 'Sin teléfono')}</small></td><td>${order.items.map(item => `${item.quantity} ${item.product.toLowerCase()}${item.color ? ` · ${escapeHtml(item.color)}` : ''}`).join('<br>')}</td><td>${formatDate(order.deliveryDate)}</td><td><span class="status-pill" data-status="${order.status}">${order.status}</span></td><td>${money(order.total)}</td><td><button class="action-link" data-proforma="${order.id}" type="button">Proforma</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="7">No se encontraron pedidos.</td></tr>';
}

function renderInventory() {
  const inventory = state.inventory.slice().sort((a, b) => a.product.localeCompare(b.product));
  document.getElementById('inventory-list').innerHTML = inventory.length ? inventory.map(item => `
    <article class="inventory-card"><h3>${escapeHtml(item.product)}</h3><p>${escapeHtml(item.color)} · Talla ${escapeHtml(item.size)}</p><div class="stock-meta"><span>Disponibles <strong>${item.quantity}</strong></span><span>${money(item.price)}</span></div></article>`).join('') : '<article class="inventory-card"><h3>Aún no hay existencias</h3><p>Agrega prendas terminadas para venderlas directamente desde la aplicación.</p></article>';
}

function renderProformas() {
  const orders = state.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  document.getElementById('proformas-list').innerHTML = orders.length ? orders.map(order => `
    <tr><td><strong>PRF-${order.number.slice(4)}</strong></td><td>${escapeHtml(order.customerName)}</td><td>${formatDate(order.createdAt.slice(0, 10))}</td><td>${money(order.total)}</td><td><button class="action-link" data-proforma="${order.id}" type="button">Ver / imprimir</button></td></tr>`).join('') : '<tr class="empty-row"><td colspan="5">Las proformas aparecerán cuando guardes pedidos.</td></tr>';
}

function render() {
  renderDashboard();
  renderOrders();
  renderInventory();
  renderProformas();
  renderSummary();
}

function readItems() {
  const items = [];
  document.querySelectorAll('.order-item').forEach(element => {
    const original = currentItems.find(item => item.id === element.dataset.itemId);
    if (!original) return;
    items.push({
      ...original,
      product: element.querySelector('[data-field="product"]').value,
      color: element.querySelector('[data-field="color"]').value.trim(),
      size: element.querySelector('[data-field="size"]').value.trim(),
      quantity: Number(element.querySelector('[data-field="quantity"]').value || 0),
      price: Number(element.querySelector('[data-field="price"]').value || 0)
    });
  });
  currentItems = items;
  return items;
}

function checkInventory(items) {
  const key = item => `${item.product}||${item.color.toLowerCase()}||${item.size.toLowerCase()}`;
  const needed = {};
  items.forEach(item => { needed[key(item)] = (needed[key(item)] || 0) + Number(item.quantity || 0); });
  for (const item of items) {
    const stock = state.inventory.find(entry => entry.product === item.product && entry.color.toLowerCase() === item.color.toLowerCase() && entry.size.toLowerCase() === item.size.toLowerCase());
    if (!stock || stock.quantity < needed[key(item)]) return item;
  }
  return null;
}

function deductInventory(items) {
  items.forEach(item => {
    const stock = state.inventory.find(entry => entry.product === item.product && entry.color.toLowerCase() === item.color.toLowerCase() && entry.size.toLowerCase() === item.size.toLowerCase());
    stock.quantity -= item.quantity;
  });
  state.inventory = state.inventory.filter(item => item.quantity > 0);
}

async function pushInventoryDeduction(items) {
  for (const item of items) {
    const stock = state.inventory.find(entry => entry.product === item.product && entry.color.toLowerCase() === item.color.toLowerCase() && entry.size.toLowerCase() === item.size.toLowerCase());
    if (!stock) throw new Error(`No se encontró existencia de ${item.product} ${item.color} talla ${item.size}.`);
    const newQuantity = stock.quantity - item.quantity;
    if (newQuantity > 0) {
      const { error } = await supabaseClient.from('inventory').update({ quantity: newQuantity, updated_at: new Date().toISOString() }).eq('id', stock.id);
      if (error) throw error;
      stock.quantity = newQuantity;
    } else {
      const { error } = await supabaseClient.from('inventory').delete().eq('id', stock.id);
      if (error) throw error;
      stock.quantity = 0;
    }
  }
}

async function saveOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const items = readItems();
  if (!form.reportValidity()) return;
  if (!items.length) return showToast('Añade al menos una prenda.');
  if (items.some(item => !item.color || !item.size || item.quantity < 1 || item.price < 0)) return showToast('Completa color, talla, cantidad y precio de cada prenda.');
  const isInventorySale = document.getElementById('order-type').value === 'inventario';
  if (isInventorySale) {
    const unavailable = checkInventory(items);
    if (unavailable) return showToast(`No hay existencia suficiente para ${unavailable.product} ${unavailable.color}, talla ${unavailable.size}.`);
  }
  const hasEmbroidery = document.getElementById('has-embroidery').checked;
  const total = itemSubtotal() + embroideryPrice();
  const orderData = {
    customerName: document.getElementById('customer-name').value.trim(),
    customerPhone: document.getElementById('customer-phone').value.trim(),
    deliveryDate: document.getElementById('delivery-date').value,
    type: document.getElementById('order-type').value,
    items,
    embroidery: hasEmbroidery ? {
      description: document.getElementById('embroidery-description').value.trim(),
      location: document.getElementById('embroidery-location').value,
      colors: document.getElementById('embroidery-colors').value.trim(),
      price: embroideryPrice()
    } : null,
    deposit: Number(document.getElementById('deposit').value || 0),
    notes: document.getElementById('notes').value.trim(),
    status: document.getElementById('order-status').value,
    subtotal: itemSubtotal(),
    total
  };
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Guardando…';
  let savedLabel = '';
  try {
    if (supabaseClient && currentUser) {
      if (isInventorySale) await pushInventoryDeduction(items);
      const { error } = await supabaseClient.from('orders').insert({
        customer_name: orderData.customerName,
        customer_phone: orderData.customerPhone,
        delivery_date: orderData.deliveryDate,
        order_type: orderData.type,
        items: orderData.items,
        embroidery: orderData.embroidery,
        deposit: orderData.deposit,
        notes: orderData.notes,
        status: orderData.status,
        subtotal: orderData.subtotal,
        total: orderData.total
      });
      if (error) throw error;
      await refreshRemoteState();
      savedLabel = state.orders[0]?.number || 'El pedido';
    } else {
      if (isInventorySale) deductInventory(items);
      const sequence = orderNumber();
      const order = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, sequence, number: orderLabel(sequence), createdAt: new Date().toISOString(), ...orderData };
      state.orders.push(order);
      persist();
      render();
      savedLabel = order.number;
    }
    resetOrderForm();
    showToast(`${savedLabel} se guardó correctamente.`);
    goTo('pedidos');
  } catch (error) {
    showToast(`No se pudo guardar el pedido: ${error.message || error}`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

function resetOrderForm() {
  document.getElementById('order-form').reset();
  document.getElementById('delivery-date').value = todayISO();
  document.getElementById('embroidery-price').value = 0;
  document.getElementById('deposit').value = 0;
  document.getElementById('embroidery-fields').hidden = true;
  currentItems = [];
  addItem();
}

async function saveStock(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const product = document.getElementById('stock-product').value;
  const color = document.getElementById('stock-color').value.trim();
  const size = document.getElementById('stock-size').value.trim();
  const quantity = Number(document.getElementById('stock-quantity').value || 0);
  const price = Number(document.getElementById('stock-price').value || 0);
  if (!color || !size || quantity < 1 || price < 0) return showToast('Completa todos los datos de la existencia.');
  const existing = state.inventory.find(item => item.product === product && item.color.toLowerCase() === color.toLowerCase() && item.size.toLowerCase() === size.toLowerCase());
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = 'Guardando…';
  try {
    if (supabaseClient && currentUser) {
      if (existing) {
        const { error } = await supabaseClient.from('inventory').update({ quantity: existing.quantity + quantity, price, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from('inventory').insert({ product, color, size, quantity, price });
        if (error) throw error;
      }
      await refreshRemoteState();
    } else {
      if (existing) { existing.quantity += quantity; existing.price = price; } else state.inventory.push({ id: `${Date.now()}-${Math.random()}`, product, color, size, quantity, price });
      persist();
      render();
    }
    form.reset();
    document.getElementById('stock-quantity').value = 1;
    document.getElementById('stock-modal').close();
    showToast('Existencia guardada en inventario.');
  } catch (error) {
    showToast(`No se pudo guardar la existencia: ${error.message || error}`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

function openProforma(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return;
  const embroidery = order.embroidery;
  const balance = Math.max(0, order.total - order.deposit);
  document.getElementById('proforma-preview').innerHTML = `
    <div class="proforma-head"><div><div class="proforma-logo">Andrea</div><p class="eyebrow">ROPA HECHA CON CUIDADO</p></div><div class="proforma-meta"><strong>PROFORMA ${order.number}</strong><br>Emisión: ${formatDate(order.createdAt.slice(0, 10))}<br>Entrega estimada: ${formatDate(order.deliveryDate)}</div></div>
    <div class="proforma-client"><div><strong>Cliente</strong><br>${escapeHtml(order.customerName)}${order.customerPhone ? `<br>${escapeHtml(order.customerPhone)}` : ''}</div><div><strong>Tipo de pedido</strong><br>${order.type === 'inventario' ? 'Venta de inventario' : 'Fabricación bajo pedido'}</div></div>
    <table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.product)} · ${escapeHtml(item.color)} · Talla ${escapeHtml(item.size)}</td><td>${item.quantity}</td><td>${money(item.price)}</td><td>${money(item.quantity * item.price)}</td></tr>`).join('')}${embroidery ? `<tr><td>Bordado: ${escapeHtml(embroidery.description || 'Sin descripción')}<br><small>${escapeHtml(embroidery.location)}${embroidery.colors ? ` · Hilos: ${escapeHtml(embroidery.colors)}` : ''}</small></td><td>1</td><td>${money(embroidery.price)}</td><td>${money(embroidery.price)}</td></tr>` : ''}</tbody></table>
    <div class="proforma-total"><div><span>Subtotal</span><span>${money(order.subtotal)}</span></div>${embroidery ? `<div><span>Bordado</span><span>${money(embroidery.price)}</span></div>` : ''}<div><span>Anticipo recibido</span><span>${money(order.deposit)}</span></div><div class="final"><span>Saldo pendiente</span><span>${money(balance)}</span></div><div class="final"><span>Total</span><span>${money(order.total)}</span></div></div>
    ${order.notes ? `<p class="proforma-foot"><strong>Observaciones:</strong> ${escapeHtml(order.notes)}</p>` : '<p class="proforma-foot">Gracias por elegir Andrea. Este documento es una proforma o recibo de pedido; no es una factura tributaria.</p>'}`;
  document.getElementById('proforma-modal').showModal();
}

function parseVoice(transcript) {
  const normalized = transcript.toLowerCase();
  const nameMatch = transcript.match(/(?:para|cliente)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+){0,3})(?=,|\. |:|\s+(?:\d+|un|una)\b|$)/i);
  if (nameMatch) document.getElementById('customer-name').value = nameMatch[1].replace(/\b\w/g, character => character.toUpperCase());
  const mapping = [
    { product: 'Camiseta', words: 'camisetas?' },
    { product: 'Pantalón', words: 'pantalones?' },
    { product: 'Conjunto de calentador', words: 'conjuntos?(?: de calentadores?)?' },
    { product: 'Suéter de lana', words: 'su[eé]teres?(?: de lana)?' }
  ];
  const colorWords = ['negro', 'negra', 'blanco', 'blanca', 'azul', 'rojo', 'roja', 'gris', 'verde', 'amarillo', 'amarilla', 'rosado', 'rosada', 'celeste', 'morado', 'morada', 'café', 'beige'];
  const found = [];
  mapping.forEach(entry => {
    const regex = new RegExp(`(?:\\b(\\d+)\\s+)?${entry.words}([^,.]*)`, 'gi');
    let match;
    while ((match = regex.exec(normalized))) {
      const context = match[2] || '';
      const color = colorWords.find(word => context.includes(word)) || '';
      const sizeMatch = context.match(/talla\s+([\w-]+)/i);
      found.push({ product: entry.product, quantity: Number(match[1] || 1), color, size: sizeMatch ? sizeMatch[1].toUpperCase() : '', price: 0 });
    }
  });
  if (found.length) { currentItems = []; found.forEach(addItem); }
  if (normalized.includes('bordad')) {
    document.getElementById('has-embroidery').checked = true;
    document.getElementById('embroidery-fields').hidden = false;
    const location = normalized.includes('espalda') ? 'Espalda' : normalized.includes('manga') ? 'Manga' : normalized.includes('pecho derecho') ? 'Pecho derecho' : 'Pecho izquierdo';
    document.getElementById('embroidery-location').value = location;
  }
  renderOrderItems();
  return found.length;
}

function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return showToast('El dictado por voz funciona en Chrome o Edge con permiso de micrófono.');
  const button = document.getElementById('voice-button');
  const result = document.getElementById('voice-result');
  const recognition = new Recognition();
  recognition.lang = 'es-EC';
  recognition.interimResults = true;
  recognition.continuous = false;
  button.classList.add('listening');
  button.innerHTML = '<span>●</span> Escuchando…';
  result.hidden = false;
  result.textContent = 'Habla con naturalidad. Ejemplo: “Para Ana, 10 camisetas negras talla M con bordado en el pecho”.';
  recognition.onresult = event => {
    const transcript = Array.from(event.results).map(item => item[0].transcript).join('');
    result.textContent = `Escuché: “${transcript}”`;
    if (event.results[0].isFinal) {
      const found = parseVoice(transcript);
      result.textContent += found ? ' Revisé los campos detectados; completa precios, tallas o detalles que falten antes de guardar.' : ' Revisa y completa el formulario antes de guardar.';
    }
  };
  recognition.onerror = event => { result.textContent = `No se pudo registrar el audio (${event.error}). Revisa el permiso del micrófono e intenta otra vez.`; };
  recognition.onend = () => { button.classList.remove('listening'); button.innerHTML = '<span>◉</span> Dictar pedido'; };
  recognition.start();
}

function attachEvents() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => goTo(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => goTo(button.dataset.go)));
  document.getElementById('menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
  document.getElementById('add-item').addEventListener('click', () => addItem());
  document.getElementById('order-items').addEventListener('input', event => {
    const row = event.target.closest('.order-item'); if (!row) return;
    const item = currentItems.find(entry => entry.id === row.dataset.itemId); if (!item) return;
    item[event.target.dataset.field] = event.target.type === 'number' ? Number(event.target.value || 0) : event.target.value;
    renderSummary();
  });
  document.getElementById('order-items').addEventListener('change', event => { if (event.target.matches('select')) renderSummary(); });
  document.getElementById('order-items').addEventListener('click', event => {
    const button = event.target.closest('.remove-item'); if (!button) return;
    const row = button.closest('.order-item'); currentItems = currentItems.filter(item => item.id !== row.dataset.itemId); renderOrderItems();
  });
  document.getElementById('has-embroidery').addEventListener('change', event => { document.getElementById('embroidery-fields').hidden = !event.target.checked; renderSummary(); });
  document.getElementById('embroidery-price').addEventListener('input', renderSummary);
  document.getElementById('order-form').addEventListener('submit', saveOrder);
  document.getElementById('voice-button').addEventListener('click', startVoice);
  document.getElementById('open-stock-modal').addEventListener('click', () => document.getElementById('stock-modal').showModal());
  document.getElementById('stock-form').addEventListener('submit', saveStock);
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeModal).close()));
  document.getElementById('orders-list').addEventListener('click', event => { const button = event.target.closest('[data-proforma]'); if (button) openProforma(button.dataset.proforma); });
  document.getElementById('proformas-list').addEventListener('click', event => { const button = event.target.closest('[data-proforma]'); if (button) openProforma(button.dataset.proforma); });
  document.getElementById('print-proforma').addEventListener('click', () => window.print());
  document.getElementById('order-search').addEventListener('input', renderOrders);
  document.getElementById('status-filter').addEventListener('change', renderOrders);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; document.getElementById('install-button').hidden = false; });
  document.getElementById('install-button').addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; document.getElementById('install-button').hidden = true; });
  document.getElementById('auth-form').addEventListener('submit', signIn);
  document.getElementById('profile-button').addEventListener('click', () => {
    if (supabaseClient && currentUser) {
      if (confirm('¿Cerrar sesión?')) signOut();
    } else {
      showToast('Esta versión está funcionando en modo local. Configura config.js para activar cuentas.');
    }
  });
}

function initialize() {
  setToday();
  document.getElementById('delivery-date').value = todayISO();
  addItem();
  attachEvents();
  render();
  initSupabase().catch(() => showToast('No se pudo conectar con Supabase. Revisa config.js.'));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

initialize();
