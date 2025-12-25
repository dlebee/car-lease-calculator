// Shared types, constants, and utilities for lease data

export interface LeaseData {
  id: string;
  carMake: string;
  carModel: string;
  carTier: string;
  dealership: string;
  vin: string; // Vehicle Identification Number
  msrp: number;
  capCostPercent: number;
  discount: number; // Discount percentage (0-100)
  discountAmount: number; // Discount amount in dollars
  residualPercent: number;
  apr: number;
  marketFactor: number;
  leaseTerm: number;
  ficoScore8: number; // FICO Score 8 (300-850)
  salesTaxPercent: number; // Sales tax percentage
  tagTitleFilingFees: number; // Tag/title/filing fees
  handlingFees: number; // Handling fees (includes acquisition fee)
  otherFees: number; // Other miscellaneous fees
  downPayment: number; // Cash down payment
  equityTransfer: number; // Trade-in equity value
  dueAtSigning: number; // Total amount due at signing (reduces cap cost)
  notes: string; // Notes for discussion/negotiation
}

export interface SavedCars {
  cars: LeaseData[];
  currentCarId: string | null;
}

export const STORAGE_KEY = 'car-lease-calculator-data';

export const createNewCar = (): LeaseData => ({
  id: Date.now().toString(),
  carMake: '',
  carModel: '',
  carTier: '',
  dealership: '',
  vin: '',
  msrp: 0,
  capCostPercent: 100,
  discount: 0, // 0% discount = 100% of MSRP
  discountAmount: 0, // Discount amount in dollars
  residualPercent: 60,
  apr: 0,
  marketFactor: 0,
  leaseTerm: 36,
  ficoScore8: 0,
  salesTaxPercent: 0,
  tagTitleFilingFees: 0,
  handlingFees: 700, // Default handling fee (includes acquisition fee)
  otherFees: 0,
  downPayment: 0,
  equityTransfer: 0,
  dueAtSigning: 0,
  notes: '',
});

export const getCarDisplayName = (car: LeaseData): string => {
  if (car.carMake && car.carModel) {
    const baseName = `${car.carMake} ${car.carModel}${car.carTier ? ` ${car.carTier}` : ''}`;
    return car.dealership ? `${baseName} - ${car.dealership}` : baseName;
  }
  return 'New Car';
};

export const getCarPayments = (car: LeaseData) => {
  const baseCapCost = car.msrp * (1 - (car.discount || 0) / 100);
  const totalFees = 
    (car.tagTitleFilingFees || 0) +
    (car.handlingFees || 0) +
    (car.otherFees || 0);
  const totalDownPayment = (car.downPayment || 0) + (car.equityTransfer || 0) + (car.dueAtSigning || 0);
  const adjustedCapCost = baseCapCost + totalFees - totalDownPayment;
  const adjustedCapCostWithTax = adjustedCapCost * (1 + (car.salesTaxPercent || 0) / 100);
  const residualValue = (car.msrp * car.residualPercent) / 100;
  const depreciation = adjustedCapCost - residualValue;
  const monthlyDepreciation = depreciation / car.leaseTerm;
  const currentApr = car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0);
  const currentMoneyFactor = car.marketFactor || (car.apr ? car.apr / 2400 : 0);
  const monthlyRate = currentApr / 100 / 12;
  const monthlyFinanceCharge = (adjustedCapCost + residualValue) * monthlyRate;
  const baseMonthlyPayment = monthlyDepreciation + monthlyFinanceCharge;
  const salesTaxMultiplier = 1 + (car.salesTaxPercent || 0) / 100;
  const totalMonthlyPayment = baseMonthlyPayment * salesTaxMultiplier;
  
  return {
    baseCapCost,
    adjustedCapCost,
    adjustedCapCostWithTax,
    totalFees,
    totalDownPayment,
    residualValue,
    depreciation,
    currentApr,
    currentMoneyFactor,
    monthlyDepreciation,
    monthlyFinanceCharge,
    baseMonthlyPayment,
    totalMonthlyPayment,
  };
};

// Migrate a single car to ensure all fields exist
export const migrateCarData = (car: any): LeaseData => {
  let updated: any = { ...car };
  
  if (car.discount === undefined) {
    const discount = (1 - car.capCostPercent / 100) * 100;
    updated = { ...updated, discount };
  }
  if (car.discountAmount === undefined) {
    const discount = updated.discount || 0;
    const discountAmount = (car.msrp * discount) / 100;
    updated = { ...updated, discountAmount };
  }
  if (car.ficoScore8 === undefined) {
    updated = { ...updated, ficoScore8: 0 };
  }
  if (car.salesTaxPercent === undefined) {
    updated = { ...updated, salesTaxPercent: 0 };
  }
  if (car.tagTitleFilingFees === undefined) {
    updated = { ...updated, tagTitleFilingFees: 0 };
  }
  if (car.handlingFees === undefined) {
    updated = { ...updated, handlingFees: 700 };
  }
  if (car.otherFees === undefined) {
    updated = { ...updated, otherFees: 0 };
  }
  if (car.downPayment === undefined) {
    updated = { ...updated, downPayment: 0 };
  }
  if (car.equityTransfer === undefined) {
    updated = { ...updated, equityTransfer: 0 };
  }
  if (car.dueAtSigning === undefined) {
    updated = { ...updated, dueAtSigning: 0 };
  }
  if (car.vin === undefined) {
    updated = { ...updated, vin: '' };
  }
  if (car.dealership === undefined) {
    updated = { ...updated, dealership: '' };
  }
  if (car.notes === undefined) {
    updated = { ...updated, notes: '' };
  }
  
  return updated as LeaseData;
};

// Load data from localStorage with migration
export const loadFromStorage = (): SavedCars | null => {
  if (typeof window === 'undefined') return null;
  
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  
  try {
    const parsed = JSON.parse(saved);
    
    // Handle migration from old format (single car) to new format (multiple cars)
    if (parsed.cars && Array.isArray(parsed.cars)) {
      // Migrate all cars
      const migratedCars = parsed.cars.map(migrateCarData);
      return {
        ...parsed,
        cars: migratedCars,
      };
    } else {
      // Old format - migrate single car to new format
      const migratedCar = migrateCarData({
        ...parsed,
        id: parsed.id || Date.now().toString(),
      });
      return {
        cars: [migratedCar],
        currentCarId: migratedCar.id,
      };
    }
  } catch (e) {
    console.error('Failed to load from localStorage:', e);
    return null;
  }
};

// Save data to localStorage
export const saveToStorage = (savedCars: SavedCars): void => {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCars));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
};

