import { STAGE_ORDER, INDIAN_STATES, UNION_TERRITORIES, LOST_REASONS, PROPERTY_TYPES, PROPERTY_CATEGORIES, SIGNAGE_SERVICES, JHES_SERVICES } from './constants';

// --- Column definitions ---

const LEAD_INFO_COLUMNS = [
  { header: 'Customer Name *', slug: 'customer_name' },
  { header: 'City', slug: 'city' },
  { header: 'State', slug: 'state' },
  { header: 'Lead Source', slug: 'lead_source' },
  { header: 'Source Name', slug: 'source_name' },
  { header: 'New or Renewal', slug: 'new_or_renewal' },
  { header: 'Lead Temperature', slug: 'lead_temperature' },
  { header: 'Competitor', slug: 'competitor' },
  { header: 'Property Type', slug: 'property_type' },
  { header: 'Property Category', slug: 'property_category' },
];

const DEAL_COLUMNS = [
  { header: 'Contract Period (Months)', slug: 'contract_period_months' },
  { header: 'TCV (Lakhs)', slug: 'tcv_lakhs' },
];

const SIGNAGE_SVC_COLUMNS = SIGNAGE_SERVICES.flatMap(s => [
  { header: `${s.label} Included (Yes/No)`, slug: `includes_${s.key}` },
  { header: `${s.label} Rate`, slug: `${s.key}_rate` },
  { header: `${s.label} Qty`, slug: `${s.key}_qty` },
]);

const JHES_SVC_COLUMNS = JHES_SERVICES.flatMap(s => [
  { header: `${s.label} Included (Yes/No)`, slug: `includes_${s.key}` },
  { header: `${s.label} Rate`, slug: `${s.key}_rate` },
  { header: `${s.label} Qty`, slug: `${s.key}_qty` },
]);

const DEVICE_COLUMNS = [
  { header: 'Device Included (Yes/No)', slug: 'includes_device' },
  { header: 'Device SKU', slug: 'device_sku' },
  { header: 'Device Cost Type', slug: 'device_cost_type' },
  { header: 'Device Rate', slug: 'device_rate' },
  { header: 'Device Qty', slug: 'device_qty' },
  { header: 'Device Expected Date', slug: 'device_requested_date' },
];

const JHES_EXTRA = [
  { header: 'JHES Product', slug: 'jhes_product' },
];

const PHASE_COLUMNS = [
  { header: 'Phase *', slug: 'phase' },
  { header: 'Next Follow-Up Date', slug: 'next_followup_date' },
  { header: 'PO Expected Date', slug: 'po_expected_date' },
  { header: 'Lost Reason', slug: 'lost_reason' },
  { header: 'Hold End Date', slug: 'hold_end_date' },
];

const PO_COLUMNS = [
  { header: 'PO Number', slug: 'po_number' },
  { header: 'Actual PO Value (Lakhs)', slug: 'po_actual_value_lakhs' },
  { header: 'Service Start Date', slug: 'service_start_date' },
  { header: 'Service End Date', slug: 'service_end_date' },
];

const NOTES_COLUMN = [
  { header: 'Additional Notes', slug: 'additional_notes' },
];

const OWNER_COLUMN = [
  { header: 'Lead Owner Email *', slug: 'owner_email' },
];

const CONTACT_COLUMNS = [
  { header: 'Contact 1 Name *', slug: 'contact_1_name' },
  { header: 'Contact 1 Email *', slug: 'contact_1_email' },
  { header: 'Contact 1 Phone', slug: 'contact_1_phone' },
  { header: 'Contact 1 Designation', slug: 'contact_1_designation' },
  { header: 'Contact 2 Name', slug: 'contact_2_name' },
  { header: 'Contact 2 Email', slug: 'contact_2_email' },
  { header: 'Contact 2 Phone', slug: 'contact_2_phone' },
  { header: 'Contact 2 Designation', slug: 'contact_2_designation' },
  { header: 'Contact 3 Name', slug: 'contact_3_name' },
  { header: 'Contact 3 Email', slug: 'contact_3_email' },
  { header: 'Contact 3 Phone', slug: 'contact_3_phone' },
  { header: 'Contact 3 Designation', slug: 'contact_3_designation' },
];

const SKIP_CUSTOM_SLUGS = new Set([
  'phase', 'next_followup_date', 'po_expected_date', 'lost_reason', 'po_type',
  'po_document_url', 'channel_partner_name', 'kam_name', 'affiliate_name',
  'customer_name', 'city', 'state', 'lead_source', 'new_or_renewal',
  'lead_temperature', 'competitor', 'property_type', 'property_category',
  'quantity', 'potential_tcv_lakhs', 'acv_lakhs', 'contract_value_lakhs',
  'contract_period_months', 'po_validity_months', 'po_number',
  'additional_notes', 'jhes_product', 'service_start_date', 'service_end_date',
]);

export function getTemplateColumns(businessUnit, config) {
  const bu = (businessUnit || '').toLowerCase();
  const cols = [
    ...LEAD_INFO_COLUMNS,
    ...DEAL_COLUMNS,
  ];

  if (bu === 'signage') {
    cols.push(...SIGNAGE_SVC_COLUMNS, ...DEVICE_COLUMNS);
  } else if (bu === 'jhes') {
    cols.push(...JHES_SVC_COLUMNS, ...DEVICE_COLUMNS, ...JHES_EXTRA);
  }

  cols.push(
    ...PHASE_COLUMNS,
    ...PO_COLUMNS,
    ...NOTES_COLUMN,
    ...OWNER_COLUMN,
    ...CONTACT_COLUMNS,
  );

  if (config && config.formSchema && !config.isOriginal) {
    for (const sec of config.formSchema.sections) {
      if (!sec.enabled) continue;
      for (const f of sec.fields) {
        if (!f.enabled || f.core || SKIP_CUSTOM_SLUGS.has(f.slug)) continue;
        cols.push({ header: f.label, slug: `custom_${f.slug}`, custom: true });
      }
    }
  }

  return cols;
}

const DROPDOWN_MAP = {
  lead_source:      ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'],
  new_or_renewal:   ['New', 'Renewal', 'Expansion'],
  lead_temperature: ['Hot', 'Warm', 'Cold'],
  property_type:    PROPERTY_TYPES,
  property_category: PROPERTY_CATEGORIES,
  phase:            STAGE_ORDER,
  lost_reason:      LOST_REASONS,
  device_cost_type: ['capex', 'opex'],
};

const ALL_STATES = [...INDIAN_STATES, ...UNION_TERRITORIES];
const MAX_DATA_ROW = 501;

export async function downloadTemplate(businessUnit, config, users) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const columns = getTemplateColumns(businessUnit, config);
  const ownerEmails = users.map(u => u.email).filter(Boolean);

  // ---- Lookups sheet (hidden) — holds long lists referenced by dropdowns ----
  const lookupSheet = wb.addWorksheet('Lookups', { state: 'veryHidden' });
  const lookupLists = [];

  const addLookupList = (label, values) => {
    const colIdx = lookupLists.length + 1;
    lookupSheet.getCell(1, colIdx).value = label;
    values.forEach((v, i) => { lookupSheet.getCell(i + 2, colIdx).value = v; });
    const colLetter = lookupSheet.getColumn(colIdx).letter;
    const ref = `Lookups!$${colLetter}$2:$${colLetter}$${values.length + 1}`;
    lookupLists.push({ ref });
    return ref;
  };

  const stateRef = addLookupList('States', ALL_STATES);
  const ownerRef = ownerEmails.length > 0 ? addLookupList('Owners', ownerEmails) : null;

  // ---- Lead Data sheet ----
  const dataSheet = wb.addWorksheet('Lead Data');

  const headerRow = dataSheet.addRow(columns.map(c => c.header));
  headerRow.eachCell(cell => {
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });

  columns.forEach((col, idx) => {
    const colNum = idx + 1;
    dataSheet.getColumn(colNum).width = Math.max(col.header.length + 2, 18);

    let formulae = null;
    let values = DROPDOWN_MAP[col.slug];
    if (col.slug.startsWith('includes_')) values = ['Yes', 'No'];

    if (values) {
      const inline = values.join(',');
      if (inline.length <= 250) {
        formulae = [`"${inline}"`];
      } else {
        const ref = addLookupList(col.slug, values);
        formulae = [ref];
      }
    } else if (col.slug === 'state') {
      formulae = [stateRef];
    } else if (col.slug === 'owner_email' && ownerRef) {
      formulae = [ownerRef];
    }

    if (!formulae) return;

    const validation = {
      type: 'list',
      allowBlank: true,
      formulae,
      showErrorMessage: true,
      errorStyle: 'information',
      errorTitle: 'Custom value',
      error: 'This value is not in the dropdown list. You can still use it.',
    };

    for (let r = 2; r <= MAX_DATA_ROW; r++) {
      dataSheet.getCell(r, colNum).dataValidation = validation;
    }
  });

  // ---- Instructions sheet ----
  const instrSheet = wb.addWorksheet('Instructions');
  instrSheet.getColumn(1).width = 34;
  instrSheet.getColumn(2).width = 90;

  const bu = (businessUnit || '').toLowerCase();
  const instrRows = [
    ['Bulk Lead Import — Instructions', ''],
    [`Business Unit: ${businessUnit.toUpperCase()}`, ''],
    [],
    ['Column', 'Valid Values / Format'],
    ['Customer Name *', 'Required. Text.'],
    ['City', 'Text.'],
    ['State', ALL_STATES.join(', ')],
    ['Lead Source', 'Channel Partner, KAM, Direct Sales, Lead Affiliate (dropdown)'],
    ['Source Name', 'If Lead Source is Channel Partner / KAM / Lead Affiliate, enter the name here.'],
    ['New or Renewal', 'New, Renewal, Expansion (dropdown)'],
    ['Lead Temperature', 'Hot, Warm, Cold (dropdown)'],
    ['Competitor', 'Text.'],
    ['Property Type', PROPERTY_TYPES.join(', ') + ' (dropdown)'],
    ['Property Category', PROPERTY_CATEGORIES.join(', ') + ' (dropdown)'],
    ['Contract Period (Months)', 'Number. Required for auto TCV calculation.'],
    ['TCV (Lakhs)', 'Number. If blank AND service rates are provided, TCV is auto-calculated.'],
  ];

  if (bu === 'signage') {
    instrRows.push(
      [],
      ['— SIGNAGE SERVICES —', ''],
      ...SIGNAGE_SERVICES.map(s => [
        `${s.label} Included`, 'Yes or No (dropdown). If Yes, provide Rate and Qty.',
      ]),
      [`${SIGNAGE_SERVICES[0].label} Rate / Qty`, 'Number. Rate per unit per month (OPEX) or one-time (CAPEX).'],
    );
  }
  if (bu === 'jhes') {
    instrRows.push(
      [],
      ['— JHES SERVICES —', ''],
      ...JHES_SERVICES.map(s => [
        `${s.label} Included`, 'Yes or No (dropdown). If Yes, provide Rate and Qty.',
      ]),
      ['JHES Product', 'Text. Free-text product description.'],
    );
  }
  if (bu === 'signage' || bu === 'jhes') {
    instrRows.push(
      [],
      ['— DEVICE —', ''],
      ['Device Included', 'Yes or No (dropdown).'],
      ['Device SKU', 'e.g. MCM3000, JSB210, J100, C2Av2, M2S'],
      ['Device Cost Type', 'capex or opex (dropdown)'],
      ['Device Rate', 'Number. Unit rate.'],
      ['Device Qty', 'Number.'],
      ['Device Expected Date', 'YYYY-MM-DD. For forecast planning.'],
    );
  }

  instrRows.push(
    [],
    ['— PHASE & TIMELINE —', ''],
    ['Phase *', `Required (dropdown). ${STAGE_ORDER.join(', ')}`],
    ['Next Follow-Up Date', 'YYYY-MM-DD. Leave blank for Lost / PO Received.'],
    ['PO Expected Date', 'YYYY-MM-DD.'],
    ['Lost Reason', `Required if Phase is Lost (dropdown). ${LOST_REASONS.join(', ')}`],
    ['Hold End Date', 'YYYY-MM-DD. For On Hold leads — when to resume.'],
    [],
    ['— PO RECEIVED FIELDS —', ''],
    ['PO Number', 'Text.'],
    ['Actual PO Value (Lakhs)', 'Number. The actual contracted value for won deals.'],
    ['Service Start Date', 'YYYY-MM-DD. When service delivery begins.'],
    ['Service End Date', 'YYYY-MM-DD. When service contract ends.'],
    [],
    ['— OWNER & CONTACTS —', ''],
    ['Lead Owner Email *', `Required (dropdown). Must match an active user. Available: ${ownerEmails.join(', ')}`],
    ['Contact 1 Name / Email *', 'At least one contact with Name and Email is required.'],
    ['Contact 2/3', 'Optional additional contacts, same format.'],
    [],
    ['Notes', ''],
    ['- Columns with a ▼ dropdown arrow have predefined values — click the cell to select.', ''],
    ['- Dates must be in YYYY-MM-DD format (e.g., 2026-09-28).', ''],
    ['- Yes/No columns accept: Yes, No (case-insensitive).', ''],
    ['- Maximum 500 rows per upload.', ''],
    ['- Do not rename or reorder columns in the Lead Data sheet.', ''],
    ['- TCV auto-calc: if you fill in service rates + qty + contract period, TCV is computed. Otherwise enter TCV manually.', ''],
  );

  instrRows.forEach(row => {
    if (row.length === 0) { instrSheet.addRow([]); }
    else { instrSheet.addRow(row); }
  });

  instrSheet.getRow(1).font = { bold: true, size: 13 };
  instrSheet.getRow(4).font = { bold: true };

  // ---- Download ----
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Bulk_Import_Template_${businessUnit.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseUploadedFile(XLSX, file, businessUnit, config) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (raw.length === 0) { reject(new Error('No data rows found.')); return; }

        const allCols = getTemplateColumns(businessUnit, config);
        const headerMap = {};
        allCols.forEach(c => { headerMap[c.header] = c.slug; });

        const rows = raw.map(r => {
          const mapped = {};
          for (const [header, value] of Object.entries(r)) {
            const cleanHeader = header.trim();
            const slug = headerMap[cleanHeader];
            if (slug) {
              mapped[slug] = formatCellValue(value);
            } else {
              if (!mapped._extraFields) mapped._extraFields = {};
              mapped._extraFields[cleanHeader] = formatCellValue(value);
            }
          }
          return mapped;
        }).filter(r => r.customer_name || r.owner_email || r.phase);

        resolve(rows);
      } catch (err) {
        reject(new Error('Could not parse the file. Make sure it is a valid .xlsx file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

function formatCellValue(v) {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') return String(v);
  return typeof v === 'string' ? v.trim() : String(v ?? '');
}

export function parseBool(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}
