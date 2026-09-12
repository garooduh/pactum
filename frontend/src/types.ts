export interface Party {
  kind: "company" | "ip";
  full_name: string;
  short_name: string;
  address: string;
  inn: string;
  kpp: string;
  registration: string;
  bank: string;
  account: string;
  correspondent: string;
  bik: string;
  phone: string;
  email: string;
  representative: boolean;
  position: string;
  position_genitive: string;
  person: string;
  person_genitive: string;
  signature: string;
  basis: string;
}
export interface Item {
  name: string;
  unit: string;
  quantity: string;
  price: string;
  material: string;
  dimensions: string;
  tolerance: string;
}
export interface Specification {
  number: string;
  items: Item[];
  description: string;
  notes: string;
  coating: string;
  color: string;
  deadline: string;
  delivery: string;
  installation: string;
}
export interface ContractData {
  type: "simple" | "full";
  number: string;
  date: string;
  city: string;
  title: string;
  payment_option?: "prepayment" | "other" | null;
  payment_other?: string;
  prepayment_percent?: string;
  balance_terms?: string;
  customer: Party;
  specification: Specification;
}
export interface Issue {
  id: string;
  revision: number;
  created_at: string;
  status: string;
  template_version: string;
  has_docx: boolean;
  has_pdf: boolean;
}
export interface Contract {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  number: string;
  customer: string;
  type: "simple" | "full";
  date: string;
  data: ContractData;
  issues: Issue[];
}
export interface Profile {
  party: Party;
  verified: boolean;
  revision: number;
}
export interface SourceNote {
  field: string;
  label: string;
  full: string;
  simple: string;
}
export const emptyParty = (): Party => ({
  kind: "company",
  full_name: "",
  short_name: "",
  address: "",
  inn: "",
  kpp: "",
  registration: "",
  bank: "",
  account: "",
  correspondent: "",
  bik: "",
  phone: "",
  email: "",
  representative: true,
  position: "",
  position_genitive: "",
  person: "",
  person_genitive: "",
  signature: "",
  basis: "",
});
export const emptyItem = (): Item => ({
  name: "",
  unit: "шт.",
  quantity: "1",
  price: "",
  material: "",
  dimensions: "",
  tolerance: "",
});
export function emptyContract(type: "simple" | "full"): ContractData {
  const date = new Date();
  return {
    type,
    number: "",
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    city: "Москва",
    title: "",
    payment_option: "prepayment",
    payment_other: "",
    prepayment_percent: "100",
    balance_terms:
      "в течение 3 банковских дней после передачи товара (результата работ)",
    customer: emptyParty(),
    specification: {
      number: "1",
      items: [emptyItem()],
      description: "",
      notes: "",
      coating: "",
      color: "",
      deadline: "",
      delivery: "",
      installation: "",
    },
  };
}
