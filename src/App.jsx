import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, RefreshCw, Search } from "lucide-react";
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/react";

const statusValues = ["RECEIVED", "PROCESSING", "READY", "DELIVERED"];
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";

function resolveApiUrl(pathname) {
  if (!apiBaseUrl) {
    return pathname;
  }

  return new URL(pathname, apiBaseUrl).toString();
}

function statusBadgeClass(status) {
  if (status === "DELIVERED") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }

  if (status === "PROCESSING") {
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }

  if (status === "READY") {
    return "bg-violet-500/10 text-violet-400 border-violet-500/20";
  }

  return "bg-blue-500/10 text-blue-400 border-blue-500/20";
}

async function requestJson(url, options = {}) {
  const response = await fetch(resolveApiUrl(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const rawBody = await response.text();
  let payload = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    let errorMessage = response.statusText;

    if (payload && typeof payload === "object") {
      errorMessage = payload.error || JSON.stringify(payload);
    } else if (rawBody) {
      errorMessage = rawBody;
    }

    const error = new Error(errorMessage || "Request failed");
    error.status = response.status;
    throw error;
  }

  return payload;
}

function garmentSummary(garments) {
  return garments.map((item) => `${item.name} x${item.quantity}`).join(", ");
}

function createGarmentRowId() {
  return `garment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultGarment() {
  return { id: createGarmentRowId(), name: "", quantity: 1, price_per_item: 50 };
}

export default function App() {
  const { user } = useUser();
  const [dashboard, setDashboard] = useState({
    total_orders: 0,
    total_revenue: 0,
    orders_per_status: {
      RECEIVED: 0,
      PROCESSING: 0,
      READY: 0,
      DELIVERED: 0,
    },
  });
  const [orders, setOrders] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [showDeliveredList, setShowDeliveredList] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [message, setMessage] = useState({ text: "", kind: "neutral" });
  const [toast, setToast] = useState({ visible: false, text: "", id: 0 });
  const [form, setForm] = useState({
    customer_name: "",
    phone_number: "",
    garments: [defaultGarment()],
  });

  const userId = user?.id || "";

  useEffect(() => {
    if (!toast.visible) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 2800);

    return () => window.clearTimeout(timer);
  }, [toast.id, toast.visible]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  async function refreshDashboard() {
    if (!userId) return;
    const data = await requestJson(
      `/dashboard?user_id=${encodeURIComponent(userId)}`,
    );
    setDashboard(data);
  }

  const refreshOrders = useMemo(
    () =>
      async function fetchOrders() {
        if (!userId) {
          setOrders([]);
          setDeliveredOrders([]);
          return;
        }

        setIsLoadingOrders(true);
        try {
          const params = new URLSearchParams();
          params.set("user_id", userId);
          const data = await requestJson(`/orders?${params.toString()}`);
          const searchNeedle = debouncedSearch.toLowerCase();

          const matchesSearch = (order) => {
            if (!searchNeedle) return true;
            return (
              order.customer_name.toLowerCase().includes(searchNeedle) ||
              order.phone_number.toLowerCase().includes(searchNeedle)
            );
          };

          const activeOrders = data.filter(
            (order) =>
              order.status !== "DELIVERED" &&
              (!statusFilter || order.status === statusFilter) &&
              matchesSearch(order),
          );

          const delivered = data
            .filter((order) => order.status === "DELIVERED")
            .filter(matchesSearch)
            .sort((a, b) => {
              const byDeliveryDate = b.estimated_delivery_date.localeCompare(
                a.estimated_delivery_date,
              );
              if (byDeliveryDate !== 0) return byDeliveryDate;
              return b.created_at.localeCompare(a.created_at);
            });

          setOrders(activeOrders);
          setDeliveredOrders(delivered);
        } finally {
          setIsLoadingOrders(false);
        }
      },
    [statusFilter, debouncedSearch, userId],
  );

  useEffect(() => {
    Promise.all([refreshOrders(), refreshDashboard()]).catch((error) => {
      setMessage({
        text: `Failed to load data: ${error.message}`,
        kind: "error",
      });
    });
  }, [refreshOrders]);

  function updateGarment(index, field, value) {
    setForm((prev) => {
      const nextGarments = prev.garments.map((garment, garmentIndex) => {
        if (garmentIndex !== index) return garment;
        return { ...garment, [field]: value };
      });
      return { ...prev, garments: nextGarments };
    });
  }

  function addGarment() {
    setForm((prev) => ({
      ...prev,
      garments: [...prev.garments, defaultGarment()],
    }));
  }

  function removeGarment(index) {
    setForm((prev) => {
      if (prev.garments.length === 1) return prev;
      return {
        ...prev,
        garments: prev.garments.filter(
          (_, garmentIndex) => garmentIndex !== index,
        ),
      };
    });
  }

  async function createOrder(event) {
    event.preventDefault();

    if (!userId) {
      setMessage({
        text: "Please sign in before creating an order.",
        kind: "error",
      });
      return;
    }

    setIsSubmittingOrder(true);

    try {
      await requestJson("/orders", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          customer_name: form.customer_name.trim(),
          phone_number: form.phone_number.trim(),
          garments: form.garments.map((item) => ({
            name: item.name.trim(),
            quantity: Number(item.quantity),
            price_per_item: Number(item.price_per_item),
          })),
        }),
      });

      setToast((prev) => ({
        visible: true,
        text: "Order created successfully.",
        id: prev.id + 1,
      }));
      setMessage({ text: "", kind: "neutral" });
      setForm({
        customer_name: "",
        phone_number: "",
        garments: [defaultGarment()],
      });
      await Promise.all([refreshOrders(), refreshDashboard()]);
    } catch (error) {
      setMessage({ text: error.message, kind: "error" });
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function updateStatus(orderId, status) {
    if (!userId) {
      throw new Error("Please sign in before updating an order.");
    }

    await requestJson(`/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, user_id: userId }),
    });

    await Promise.all([refreshOrders(), refreshDashboard()]);
  }

  return (
    <>
      <Show when="signed-out">
        <main className="min-h-screen flex items-center justify-center p-4">
          <section className="w-full max-w-md bg-neutral-900/80 border border-neutral-800 rounded-3xl p-6 md:p-8 backdrop-blur-xl">
            <h1 className="text-3xl font-semibold tracking-tight text-white mb-2">
              Laundry Desk Login
            </h1>
            <p className="text-neutral-400 mb-6">
              Sign in to access order management.
            </p>

            <div className="flex flex-col gap-3">
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="w-full px-6 py-3.5 rounded-2xl bg-blue-600 text-white hover:bg-blue-500 transition-colors text-base font-semibold"
                >
                  Sign in
                </button>
              </SignInButton>

              <SignUpButton mode="modal">
                <button
                  type="button"
                  className="w-full px-6 py-3.5 rounded-2xl bg-neutral-800 text-white hover:bg-neutral-700 transition-colors text-base font-semibold"
                >
                  Sign up
                </button>
              </SignUpButton>
            </div>
          </section>
        </main>
      </Show>

      <Show when="signed-in">
        <main className="md:p-8 flex flex-col md:gap-10 w-full max-w-[1400px] mr-auto ml-auto pt-4 pr-4 pb-4 pl-4 gap-x-8 gap-y-8">
          <header className="flex flex-col gap-3 pt-4 md:pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-white">
                  Laundry Desk
                </h1>
                <p className="text-lg text-neutral-400 max-w-3xl leading-relaxed mt-3">
                  A lightweight dry-cleaning order system with order creation,
                  status tracking, billing, search, and a dashboard.
                </p>
              </div>
              <div className="self-start">
                <UserButton />
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10">
            <section className="h-full bg-neutral-900/80 border-neutral-800 border rounded-3xl p-6 md:p-8 flex flex-col backdrop-blur-xl">
              <h2 className="md:mb-8 text-2xl font-semibold text-white tracking-tight mb-6">
                Summary
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 h-full">
                <MetricCard
                  value={dashboard.total_orders}
                  label="Total Orders"
                />
                <MetricCard
                  value={Number(dashboard.total_revenue || 0).toFixed(2)}
                  label="Revenue"
                />
                <MetricCard
                  value={dashboard.orders_per_status.RECEIVED || 0}
                  label="Received"
                />
                <MetricCard
                  value={dashboard.orders_per_status.PROCESSING || 0}
                  label="Processing"
                />
                <MetricCard
                  value={dashboard.orders_per_status.READY || 0}
                  label="Ready"
                />
                <MetricCard
                  value={dashboard.orders_per_status.DELIVERED || 0}
                  label="Delivered"
                />
              </div>
            </section>

            <section className="h-full bg-neutral-900/80 border-neutral-800 border rounded-3xl p-6 md:p-8 flex flex-col backdrop-blur-xl">
              <div className="w-full flex flex-col h-full">
                <h2 className="text-2xl font-semibold tracking-tight text-white mb-8">
                  Create Order
                </h2>
                <form
                  className="flex flex-col gap-6 flex-grow justify-between"
                  onSubmit={createOrder}
                >
                  <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                      <div className="flex flex-col gap-2">
                        <label className="text-base font-medium text-neutral-400 pl-1">
                          Customer name
                        </label>
                        <input
                          name="customer_name"
                          type="text"
                          value={form.customer_name}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              customer_name: event.target.value,
                            }))
                          }
                          placeholder="Amina Khan"
                          required
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-5 py-4 text-base text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-base font-medium text-neutral-400 pl-1">
                          Phone number
                        </label>
                        <input
                          name="phone_number"
                          type="tel"
                          value={form.phone_number}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              phone_number: event.target.value,
                            }))
                          }
                          placeholder="9876543210"
                          required
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-5 py-4 text-base text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      {form.garments.map((garment, index) => (
                        <div
                          key={garment.id}
                          className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end flex-wrap xl:flex-nowrap"
                        >
                          <label className="flex flex-col gap-2 flex-grow min-w-[150px]">
                            <span className="text-base font-medium text-neutral-400 pl-1">
                              Garment name
                            </span>
                            <input
                              name="garment_name"
                              type="text"
                              placeholder="Garment name"
                              value={garment.name}
                              onChange={(event) =>
                                updateGarment(index, "name", event.target.value)
                              }
                              required
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-5 py-4 text-base text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
                            />
                          </label>
                          <label className="flex flex-col gap-2 w-full sm:w-28">
                            <span className="text-base font-medium text-neutral-400 pl-1">
                              Quantity
                            </span>
                            <input
                              name="quantity"
                              type="number"
                              min="1"
                              placeholder="Quantity"
                              value={garment.quantity}
                              onChange={(event) =>
                                updateGarment(
                                  index,
                                  "quantity",
                                  Number(event.target.value),
                                )
                              }
                              required
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-5 py-4 text-base text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
                            />
                          </label>
                          <label className="flex flex-col gap-2 w-full sm:w-32">
                            <span className="text-base font-medium text-neutral-400 pl-1">
                              Price
                            </span>
                            <input
                              name="price_per_item"
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder="Price"
                              value={garment.price_per_item}
                              onChange={(event) =>
                                updateGarment(
                                  index,
                                  "price_per_item",
                                  Number(event.target.value),
                                )
                              }
                              required
                              className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-5 py-4 text-base text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => removeGarment(index)}
                            className="hover:bg-neutral-800 hover:text-white transition-colors whitespace-nowrap flex text-base font-medium text-neutral-300 bg-red-500/10 text-red-500 hover:bg-red-500 border-neutral-700/50 hover:border-red-500 border rounded-2xl px-5 py-4 items-center justify-center flex-grow sm:flex-grow-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-4 mt-auto">
                    <button
                      type="button"
                      onClick={addGarment}
                      className="px-6 py-3.5 rounded-2xl bg-neutral-800 text-white hover:bg-neutral-700 transition-colors text-base font-medium shadow-sm flex items-center gap-2"
                    >
                      <Plus size={20} strokeWidth={1.5} />
                      Add garment
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingOrder}
                      className="px-8 py-3.5 rounded-2xl bg-blue-600 text-white hover:bg-blue-500 transition-colors text-base font-semibold shadow-sm shadow-blue-900/20 flex-grow sm:flex-grow-0 text-center justify-center flex disabled:opacity-60"
                    >
                      {isSubmittingOrder ? "Creating..." : "Create order"}
                    </button>
                  </div>
                  <p
                    className={`text-sm min-h-5 ${
                      message.kind === "error"
                        ? "text-red-400"
                        : "text-neutral-400"
                    }`}
                  >
                    {message.text}
                  </p>
                </form>
              </div>
            </section>
          </div>

          <section className="bg-neutral-900/80 border border-neutral-800 rounded-3xl p-6 md:p-8 backdrop-blur-xl flex flex-col gap-6 mt-2 md:mt-0">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    {showDeliveredList ? "Delivered Orders" : "Orders"}
                  </h2>
                  <p className="text-base text-neutral-400">
                    {showDeliveredList
                      ? "Sorted by delivery date."
                      : "Update status inline from the table."}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDeliveredList((prev) => !prev)}
                    className="px-6 py-3.5 rounded-2xl bg-neutral-800 text-white hover:bg-neutral-700 transition-colors text-base font-medium shadow-sm flex items-center justify-center gap-2 flex-shrink-0"
                  >
                    {showDeliveredList ? "Hide Delivered" : "Show Delivered"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      Promise.all([refreshOrders(), refreshDashboard()])
                    }
                    className="px-6 py-3.5 rounded-2xl bg-neutral-800 text-white hover:bg-neutral-700 transition-colors text-base font-medium shadow-sm flex items-center justify-center gap-2 flex-shrink-0"
                  >
                    <RefreshCw size={20} strokeWidth={1.5} />
                    Refresh list
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-2 md:col-span-1">
                  <label className="text-base font-medium text-neutral-400 pl-1">
                    Status
                  </label>
                  <div className="relative">
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      disabled={showDeliveredList}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl pl-5 pr-12 py-4 text-base text-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner cursor-pointer"
                    >
                      <option value="">All Statuses</option>
                      {statusValues
                        .filter((status) => status !== "DELIVERED")
                        .map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                    </select>
                    <ChevronDown
                      size={20}
                      strokeWidth={1.5}
                      className="absolute right-5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 md:col-span-3">
                  <label className="text-base font-medium text-neutral-400 pl-1">
                    Search customer / phone
                  </label>
                  <div className="relative">
                    <Search
                      size={20}
                      strokeWidth={1.5}
                      className="absolute left-5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                    />
                    <input
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      type="text"
                      placeholder="Search..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl pl-12 pr-5 py-4 text-base text-white placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all shadow-inner"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
              <div className="min-w-[1000px] flex flex-col">
                <div className="grid grid-cols-12 gap-4 py-4 border-b border-neutral-800/80 text-sm font-medium text-neutral-500 tracking-wider uppercase mb-2">
                  <div className="col-span-2 pl-2">Order</div>
                  <div className="col-span-3">Customer</div>
                  <div className="col-span-3">Garments</div>
                  <div className="col-span-1 text-right">Total</div>
                  <div className="col-span-1 text-center">Status</div>
                  <div className="col-span-2 text-right pr-2">Actions</div>
                </div>

                <div className="flex flex-col gap-2">
                  {(() => {
                    const listToRender = showDeliveredList
                      ? deliveredOrders
                      : orders;

                    return isLoadingOrders ? (
                      <div className="py-8 text-center text-neutral-500 border border-neutral-800 rounded-2xl">
                        Loading orders...
                      </div>
                    ) : listToRender.length === 0 ? (
                      <div className="py-8 text-center text-neutral-500 border border-neutral-800 rounded-2xl">
                        {showDeliveredList
                          ? "No delivered orders yet."
                          : "No orders found."}
                      </div>
                    ) : (
                      listToRender.map((order) => (
                        <div
                          key={order.order_id}
                          className="grid grid-cols-12 gap-4 py-4 items-center bg-neutral-900/50 hover:bg-neutral-800/50 border border-transparent hover:border-neutral-800 rounded-2xl transition-colors px-2 -ml-2"
                        >
                          <div className="col-span-2 flex flex-col gap-1">
                            <span className="text-base font-semibold text-white">
                              {order.order_id.slice(0, 12)}
                            </span>
                            <span className="text-sm text-neutral-500">
                              Del: {order.estimated_delivery_date}
                            </span>
                          </div>
                          <div className="col-span-3 flex flex-col gap-1">
                            <span className="text-base text-neutral-200">
                              {order.customer_name}
                            </span>
                            <span className="text-sm text-neutral-500">
                              {order.phone_number}
                            </span>
                          </div>
                          <div className="col-span-3 text-base text-neutral-300 truncate pr-4">
                            {garmentSummary(order.garments)}
                          </div>
                          <div className="col-span-1 text-base font-medium text-white text-right">
                            {Number(order.total_amount).toFixed(2)}
                          </div>
                          <div className="col-span-1 flex justify-center">
                            <span
                              className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border uppercase tracking-wider ${statusBadgeClass(
                                order.status,
                              )}`}
                            >
                              {order.status}
                            </span>
                          </div>
                          <div className="col-span-2 flex justify-end">
                            {showDeliveredList ? (
                              <span className="text-sm text-neutral-500">
                                Delivered
                              </span>
                            ) : (
                              <select
                                value={order.status}
                                onChange={(event) =>
                                  updateStatus(
                                    order.order_id,
                                    event.target.value,
                                  )
                                }
                                className="w-full max-w-[140px] bg-neutral-950 border border-neutral-700/50 rounded-xl px-4 py-2.5 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all cursor-pointer hover:border-neutral-600"
                              >
                                {statusValues.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      ))
                    );
                  })()}
                </div>
              </div>
            </div>
          </section>

          <div className="fixed bottom-6 right-6 z-[100] pointer-events-none">
            <div
              className={`transition-all duration-300 ease-out ${
                toast.visible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-2 opacity-0"
              }`}
            >
              <div className="pointer-events-auto flex items-center gap-3 bg-emerald-500/20 border border-emerald-300/70 text-emerald-100 rounded-2xl px-5 py-3 shadow-2xl shadow-emerald-950/40 backdrop-blur-md min-w-[280px]">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="text-sm font-semibold">{toast.text}</span>
                <button
                  type="button"
                  onClick={() =>
                    setToast((prev) => ({ ...prev, visible: false }))
                  }
                  className="ml-auto text-emerald-100/80 hover:text-white"
                  aria-label="Close notification"
                >
                  x
                </button>
              </div>
            </div>
          </div>
        </main>
      </Show>
    </>
  );
}

function MetricCard({ value, label }) {
  return (
    <div className="bg-neutral-950/50 border border-neutral-800/50 rounded-3xl p-5 flex flex-col items-center justify-center text-center transition-transform hover:scale-[1.02] duration-300">
      <span className="text-3xl md:text-4xl font-semibold tracking-tight text-white mb-2">
        {value}
      </span>
      <span className="text-sm font-medium text-neutral-500 tracking-wider uppercase">
        {label}
      </span>
    </div>
  );
}
