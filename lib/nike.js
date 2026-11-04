const API_BASE = "https://api.api.sh";
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
        if (typeof value === "number" && Number.isFinite(value))
            return String(value);
    }
    return undefined;
}
function numeric(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const cleaned = value.replace(/[^0-9.]/g, "");
        if (!cleaned)
            return undefined;
        const parsed = Number(cleaned);
        if (Number.isFinite(parsed))
            return parsed;
    }
    const obj = record(value);
    if (obj)
        return numeric(obj.amount ?? obj.value ?? obj.price);
    return undefined;
}
function textValue(value) {
    if (typeof value === "string" && value.trim())
        return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (Array.isArray(value))
        return value.map(textValue).filter(Boolean).join(" ") || undefined;
    const obj = record(value);
    if (obj)
        return firstString(obj.name, obj.label, obj.value, obj.localized_label, obj.title);
    return undefined;
}
function audienceText(item, title, subtitle) {
    const explicit = [item.gender, item.genders, item.gender_name, item.genderName, item.target_gender,
        item.targetGender, item.audience, item.product_gender, item.gender_label, item.genderLabel,
        item.category, item.categories, item.product_type, item.productType, item.product_category,
        item.productCategory, item.classification]
        .map(textValue).filter(Boolean).join(" ");
    return `${title ?? ""} ${subtitle ?? ""} ${explicit}`.toLowerCase();
}
function hasYouthSizeLabels(item) {
    const sizes = normalizeSizeList(item.sizes ?? item.size_availability ?? item.available_sizes) ?? [];
    return sizes.some((size) => /\d+(?:\.\d+)?\s*y\b/i.test(`${size.label} ${size.localizedLabel ?? ""}`));
}
function normalizeGender(item, title, subtitle) {
    const titleAndSubtitle = `${title ?? ""} ${subtitle ?? ""}`.toLowerCase();
    const raw = audienceText(item, title, subtitle);
    // Specific youth taxonomy or explicit Y sizing wins over broad/inconsistent metadata.
    const youthMarkers = /\b(big kids?|grade school|gs|little kids?|preschool|ps|toddler|infant|youth|kids?|boys?|girls?)\b/;
    if (youthMarkers.test(titleAndSubtitle) || youthMarkers.test(raw) || hasYouthSizeLabels(item))
        return "Kids";
    // The product's own title/subtitle is more specific than a broad provider audience
    // tag. API.SH can label a Men's Shoes listing as Unisex; do not let that generic tag
    // hide the shoe when a shopper filters for Men. Support straight and curly apostrophes.
    const descriptorHasMen = /\bmen(?:['’]s)?\b/.test(titleAndSubtitle);
    const descriptorHasWomen = /\bwomen(?:['’]s)?\b/.test(titleAndSubtitle);
    if (descriptorHasMen && descriptorHasWomen)
        return "Unisex";
    if (descriptorHasMen)
        return "Men";
    if (descriptorHasWomen)
        return "Women";
    const saysWomen = /\bwomen|woman|female\b/.test(raw);
    const saysMen = /\bmen|man|male\b/.test(raw);
    if (/\bunisex|all gender|all-gender\b/.test(raw) || (saysWomen && saysMen))
        return "Unisex";
    if (saysWomen)
        return "Women";
    if (saysMen)
        return "Men";
    if (/\bkid|child|youth|toddler|infant|baby|grade school|preschool|boys?|girls?\b/.test(raw))
        return "Kids";
    return "Unknown";
}
function normalizeSizeSystem(item, gender, title, subtitle) {
    const text = `${title ?? ""} ${subtitle ?? ""}`.toLowerCase();
    if (/\b(infant|baby)\b/.test(text))
        return "infant";
    if (/\b(toddler|td|crib)\b/.test(text))
        return "toddler";
    if (/\b(big kids?|grade school|gs shoes|little kids?|preschool|ps shoes|youth|kids?'? shoes)\b/.test(text))
        return "youth";
    if (hasYouthSizeLabels(item))
        return "youth";
    if (gender === "Kids")
        return "youth";
    if (gender === "Men")
        return "men";
    if (gender === "Women")
        return "women";
    if (gender === "Unisex")
        return "unisex";
    return "unknown";
}
function normalizeCategory(item, title, subtitle) {
    const raw = [item.category, item.categories, item.product_type, item.productType, item.product_category,
        item.productCategory, item.classification, subtitle, title].map(textValue).filter(Boolean).join(" ").toLowerCase();
    if (/shoe|sneaker|running|basketball|football boot|cleat|sandals|slide/.test(raw))
        return "Shoes";
    if (/shirt|hoodie|jacket|fleece|pants|shorts|leggings|bra|jersey|sweatshirt|tee|apparel|clothing/.test(raw))
        return "Apparel";
    if (/bag|backpack|cap|hat|socks|glove|bottle|accessor|equipment/.test(raw))
        return "Accessories";
    return "Other";
}
function imageFrom(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = imageFrom(item);
            if (found)
                return found;
        }
    }
    const obj = record(value);
    if (obj)
        return firstString(obj.url, obj.src, obj.href, obj.image_url, obj.imageUrl);
    return undefined;
}
export function productArray(payload) {
    const root = record(payload);
    if (!root)
        return Array.isArray(payload) ? payload : [];
    const candidates = [
        root.products,
        root.items,
        root.results,
        root.data,
        record(root.data)?.products,
        record(root.data)?.items,
        record(root.data)?.results,
        record(root.raw)?.products,
    ];
    for (const candidate of candidates)
        if (Array.isArray(candidate))
            return candidate;
    // Provider responses can evolve. Find a shallow array of product-like objects without
    // accepting arbitrary nested arrays such as review images or size rows.
    for (const value of Object.values(root)) {
        if (!Array.isArray(value) || value.length === 0)
            continue;
        const sample = record(value[0]);
        if (sample && (sample.title || sample.name || sample.product_name || sample.url || sample.product_url))
            return value;
    }
    return [];
}
function safeNikeUrl(value) {
    const raw = firstString(value);
    if (!raw)
        return undefined;
    try {
        const url = new URL(raw, "https://www.nike.com");
        if (url.protocol !== "https:" || !(url.hostname === "nike.com" || url.hostname.endsWith(".nike.com")))
            return undefined;
        return url.toString();
    }
    catch {
        return undefined;
    }
}
function explicitBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number" && (value === 0 || value === 1))
        return value === 1;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "yes", "1", "available", "in_stock", "in stock"].includes(normalized))
            return true;
        if (["false", "no", "0", "unavailable", "out_of_stock", "out of stock", "oos"].includes(normalized))
            return false;
    }
    return undefined;
}
function statusValue(item) {
    const availability = record(item.availability);
    const inventory = record(item.inventory);
    const values = [
        item.stock_status, item.stockStatus, item.availability_status, item.availabilityStatus,
        item.stock_level, item.stockLevel, item.inventory_level, item.inventoryLevel,
        item.availability_level, item.availabilityLevel, item.inventory_status, item.inventoryStatus,
        item.level, item.ship, item.status, item.availability,
        availability?.stock_status, availability?.stockStatus, availability?.status,
        availability?.state, availability?.level, availability?.ship,
        inventory?.status, inventory?.state, inventory?.availability,
    ].map((value) => firstString(value)).filter((value) => Boolean(value));
    // Prefer explicit sold-out signals over generic SKU states such as ACTIVE.
    const outOfStock = values.find((value) => /^(out[_\s-]?of[_\s-]?stock|oos|sold[_\s-]?out|unavailable|not[_\s-]?available|not[_\s-]?in[_\s-]?stock|no[_\s-]?stock)$/i.test(value.trim()));
    if (outOfStock)
        return outOfStock;
    const inventorySignal = values.find((value) => /^(in[_\s-]?stock|available|high|medium|low|limited|few|low[_\s-]?stock|limited[_\s-]?stock)$/i.test(value.trim()));
    return inventorySignal ?? values[0];
}
function sizeAvailability(item) {
    const availability = record(item.availability);
    const inventory = record(item.inventory);
    const explicit = [
        // Restrict positives to actual stock fields. `is_buyable`/`purchasable` can
        // describe a catalog/SKU record and are not reliable size-level stock signals.
        item.available, item.is_available, item.isAvailable, item.in_stock, item.inStock,
        availability?.available, availability?.is_available, availability?.isAvailable,
        inventory?.available, inventory?.in_stock, inventory?.inStock,
    ].map(explicitBoolean).find((value) => value !== undefined);
    const status = statusValue(item);
    const normalized = status?.toLowerCase().replace(/[\s-]+/g, "_").trim();
    // A definitive sold-out state always wins over a contradictory positive flag.
    // This prevents stale/aggregated `available: true` values from overriding OOS.
    if (normalized && /^(out_of_stock|oos|sold_out|unavailable|not_available|not_in_stock|no_stock)$/.test(normalized)) {
        return { available: false, status };
    }
    if (explicit !== undefined)
        return { available: explicit, status };
    if (!normalized)
        return { available: null };
    // HIGH/MEDIUM/LOW are Nike shipping stock levels in API.SH product size data.
    // Generic catalog states such as ACTIVE/INACTIVE/ENABLED are not inventory.
    if (/^(in_stock|available|high|medium|low|limited|few|low_stock|limited_stock)$/.test(normalized)) {
        return { available: true, status };
    }
    return { available: null, status };
}
function normalizeSizeList(value) {
    const wrapper = record(value);
    const entries = Array.isArray(value)
        ? value
        : Array.isArray(wrapper?.sizes) ? wrapper.sizes
            : Array.isArray(wrapper?.items) ? wrapper.items
                : Array.isArray(wrapper?.results) ? wrapper.results
                    : undefined;
    if (!entries)
        return undefined;
    const sizes = entries.flatMap((entry) => {
        const item = record(entry);
        if (!item) {
            const label = firstString(entry);
            return label ? [{ label, available: null }] : [];
        }
        const label = firstString(item.label, item.localized_label, item.localizedLabel, item.size, item.name, item.value);
        if (!label)
            return [];
        const localizedLabel = firstString(item.localized_label, item.localizedLabel);
        const stock = sizeAvailability(item);
        return [{ label, localizedLabel, status: stock.status, available: stock.available }];
    });
    return sizes.length ? sizes : undefined;
}
export function normalizeNikeProduct(value) {
    const item = record(value);
    if (!item)
        return null;
    const title = firstString(item.title, item.name, item.product_name, item.productName, item.subtitle);
    const url = safeNikeUrl(item.url ?? item.product_url ?? item.productUrl ?? item.pdp_url ?? item.href ?? item.link ?? item.product_link ?? record(item.links)?.product);
    if (!title || !url)
        return null;
    const pricing = record(item.pricing) ?? record(item.price_data);
    const price = numeric(item.price ?? item.current_price ?? item.sale_price ?? item.currentPrice ?? item.salePrice ?? pricing?.current);
    const fullPrice = numeric(item.full_price ?? item.original_price ?? item.list_price ?? item.fullPrice ?? item.originalPrice ?? pricing?.full ?? pricing?.original);
    const directDiscount = numeric(item.discount_percent ?? item.discountPercentage ?? item.discount);
    const discountPercent = directDiscount !== undefined && directDiscount <= 100
        ? Math.round(directDiscount)
        : price !== undefined && fullPrice !== undefined && fullPrice > price
            ? Math.round(((fullPrice - price) / fullPrice) * 100)
            : undefined;
    const images = item.images ?? item.image_urls;
    const subtitle = firstString(item.subtitle, item.description, item.category, item.product_type);
    const raw = record(item.raw);
    const sizes = normalizeSizeList(item.sizes ?? item.size_availability ?? item.sizeAvailability ?? item.available_sizes ??
        item.availableSizes ?? item.size_options ?? item.sizeOptions ?? raw?.sizes ?? raw?.size_availability);
    const gender = normalizeGender(item, title, subtitle);
    const rawOnSale = item.on_sale ?? item.onSale ?? item.is_sale ?? item.isSale ?? item.sale;
    const onSale = rawOnSale === true || (discountPercent ?? 0) > 0 || (price !== undefined && fullPrice !== undefined && fullPrice > price);
    return {
        id: firstString(item.id, item.product_id, item.productId, item.style_code, item.sku, item.style_color) ?? url,
        title,
        subtitle,
        styleCode: firstString(item.style_code, item.styleColor, item.style_color, item.sku, item.product_code),
        url,
        imageUrl: imageFrom(item.image ?? item.image_url ?? item.imageUrl ?? item.hero_image ?? images),
        price,
        fullPrice,
        currency: firstString(item.currency, record(item.price)?.currency, record(pricing?.current)?.currency) ?? "USD",
        discountPercent,
        sizes,
        gender,
        sizeSystem: normalizeSizeSystem(item, gender, title, subtitle),
        onSale,
        category: normalizeCategory(item, title, subtitle),
    };
}
export async function nikeApiRequest(path, params) {
    const key = process.env.API_SH_KEY;
    if (!key)
        throw new Error("Nike product search is not configured. Add API_SH_KEY in Vercel environment variables.");
    const url = new URL(`${API_BASE}${path}`);
    for (const [name, value] of Object.entries(params))
        if (value)
            url.searchParams.set(name, value);
    const response = await fetch(url, {
        headers: { "x-api-key": key, accept: "application/json" },
        // Search results are cached briefly by Next; provider cache metadata is still shown.
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = firstString(record(payload)?.error, record(payload)?.message) ?? `Product data provider returned HTTP ${response.status}.`;
        throw new Error(message);
    }
    return payload;
}
export function providerMeta(payload) {
    const root = record(payload);
    return {
        cached: typeof root?.cached === "boolean" ? root.cached : undefined,
        fetchedAt: firstString(root?.fetched_at, root?.fetchedAt),
        creditsUsed: numeric(root?.credits_used),
    };
}
