export function fromInvoice(invoice, config) {
  const b = invoice.customer_snapshot,
    s = invoice.seller_snapshot;
  return {
    invoiceType: invoice.invoice_type,
    invoiceDate:
      typeof invoice.invoice_date === "string"
        ? invoice.invoice_date.slice(0, 10)
        : invoice.invoice_date.toISOString().slice(0, 10),
    sellerNTNCNIC: s.ntn,
    sellerBusinessName: s.name,
    sellerProvince: s.province,
    sellerAddress: s.address,
    buyerNTNCNIC: b.ntn_cnic,
    buyerBusinessName: b.business_name,
    buyerProvince: b.province,
    buyerAddress: b.address,
    buyerRegistrationType: b.registration_type,
    invoiceRefNo: invoice.invoice_ref_no,
    ...(config.appEnv === "sandbox" ? { scenarioId: invoice.scenario_id } : {}),
    items: invoice.items.map(({ snapshot: i }) => ({
      hsCode: i.hsCode,
      productDescription: i.productDescription,
      rate: i.rate,
      uoM: i.uoM,
      quantity: i.quantity,
      totalValues: i.totalValues,
      valueSalesExcludingST: i.valueSalesExcludingST,
      fixedNotifiedValueOrRetailPrice: i.fixedNotifiedValueOrRetailPrice,
      salesTaxApplicable: i.salesTaxApplicable,
      salesTaxWithheldAtSource: i.salesTaxWithheldAtSource,
      extraTax: i.extraTax,
      furtherTax: i.furtherTax,
      sroScheduleNo: i.sroScheduleNo,
      fedPayable: i.fedPayable,
      discount: i.discount,
      saleType: i.saleType,
      sroItemSerialNo: i.sroItemSerialNo,
    })),
  };
}
