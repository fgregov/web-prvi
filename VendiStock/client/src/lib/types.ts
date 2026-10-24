export interface Product {
  id: number;
  code: string;
  name: string;
  category_id: number | null;
  category_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  purchase_price: number;
  unit: string;
  pack_size: number;
  min_stock: number;
  target_stock: number;
  active: number;
  note: string | null;
  current_stock: number;
  total_stock: number;
  reserved_qty: number;
  televend_links: number;
  televend_names: string | null;
  is_low: number;
  auto_created: number;
  price_set: number;
}

export interface Category {
  id: number;
  name: string;
  product_count: number;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  oib: string | null;
  address: string | null;
  note: string | null;
  active: number;
  product_count: number;
}

export interface Location {
  id: number;
  type: 'central' | 'vehicle' | 'machine' | 'other';
  name: string;
  machine_id: number | null;
  machine_name: string | null;
  active: number;
  note: string | null;
  product_count: number;
}

export interface Machine {
  id: number;
  name: string;
  location_text: string | null;
  serial_no: string | null;
  active: number;
  source: 'televend' | 'manual' | 'upload';
  source_id: string | null;
  last_seen_at: string | null;
  location_id: number | null;
  stock_location_name: string | null;
  sold_qty: number;
  revenue: number | null;
  last_sale_at: string | null;
  stock_qty: number;
  pending_refills: number;
}

export interface Recommendation {
  productId: number;
  code: string;
  name: string;
  unit: string;
  categoryName: string | null;
  supplierId: number | null;
  supplierName: string | null;
  stock: number;
  reserved: number;
  available: number;
  minStock: number;
  targetStock: number;
  openOrders: number;
  rawQty: number;
  orderQty: number;
  packSize: number;
  packs: number | null;
  purchasePrice: number;
  estimatedCost: number;
  belowMin: boolean;
}

export interface ProductSales {
  key: string;
  productId: number | null;
  code: string | null;
  name: string;
  categoryName: string | null;
  mapped: boolean;
  qty: number;
  revenue: number | null;
  transactions: number;
  avgDailyQty: number;
}

export interface SeriesPoint {
  period: string;
  qty: number;
  revenue: number | null;
  transactions: number;
}

export type ConnectionState =
  | 'not_configured'
  | 'configured'
  | 'connected'
  | 'auth_failed'
  | 'mfa_required'
  | 'captcha_required'
  | 'form_not_found'
  | 'error'
  | 'disconnected';
