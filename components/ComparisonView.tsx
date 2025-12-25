'use client';

import { useState, useEffect } from 'react';
import {
  LeaseData,
  SavedCars,
  getCarDisplayName,
  getCarPayments,
  loadFromStorage,
} from '@/lib/leaseData';

export default function ComparisonView() {
  const [savedCars, setSavedCars] = useState<SavedCars>({
    cars: [],
    currentCarId: null,
  });
  const [selectedCarIds, setSelectedCarIds] = useState<Set<string>>(new Set());

  // Load from localStorage
  useEffect(() => {
    const loaded = loadFromStorage();
    if (loaded && loaded.cars.length > 0) {
      setSavedCars(loaded);
      setSelectedCarIds(new Set(loaded.cars.map((c) => c.id)));
    }
  }, []);

  // Sync selectedCarIds when cars change
  useEffect(() => {
    if (savedCars.cars.length > 0) {
      if (selectedCarIds.size === 0) {
        setSelectedCarIds(new Set(savedCars.cars.map(car => car.id)));
      } else {
        const existingIds = new Set(savedCars.cars.map(car => car.id));
        const updatedSelectedIds = new Set([...selectedCarIds].filter(id => existingIds.has(id)));
        if (updatedSelectedIds.size === 0 && savedCars.cars.length > 0) {
          setSelectedCarIds(existingIds);
        } else {
          setSelectedCarIds(updatedSelectedIds);
        }
      }
    }
  }, [savedCars.cars]);

  if (savedCars.cars.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <p className="text-gray-600 dark:text-gray-400">No cars to compare. Add at least one car to use the comparison view.</p>
      </div>
    );
  }

  const formatCurrency = (amount: number) => 
    `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Filter to only selected cars, then sort by total monthly payment (with tax) - least expensive first
  const selectedCars = savedCars.cars.filter(car => selectedCarIds.has(car.id));
  const sortedCars = [...selectedCars].sort((a, b) => {
    const paymentsA = getCarPayments(a);
    const paymentsB = getCarPayments(b);
    return paymentsA.totalMonthlyPayment - paymentsB.totalMonthlyPayment;
  });

  const handleToggleCar = (carId: string) => {
    setSelectedCarIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(carId)) {
        newSet.delete(carId);
        if (newSet.size === 0 && savedCars.cars.length > 1) {
          return prev;
        }
      } else {
        newSet.add(carId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    setSelectedCarIds(new Set(savedCars.cars.map(car => car.id)));
  };

  const handleUnselectAll = () => {
    if (savedCars.cars.length > 0) {
      setSelectedCarIds(new Set([savedCars.cars[0].id]));
    }
  };

  if (sortedCars.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
        <p className="text-gray-600 dark:text-gray-400">Please select at least one car to compare.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Car Selection Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Car Comparison</h2>
          <div className="flex gap-2">
            <button
              onClick={handleSelectAll}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Select All
            </button>
            <button
              onClick={handleUnselectAll}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              Unselect All
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedCars.cars.map((car) => {
            const isSelected = selectedCarIds.has(car.id);
            const payments = getCarPayments(car);
            return (
              <label
                key={car.id}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border-2 cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleCar(car.id)}
                  className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                  disabled={isSelected && selectedCarIds.size === 1}
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{getCarDisplayName(car)}</span>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {formatCurrency(payments.totalMonthlyPayment)}/mo
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="border-b-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800">
                <th className="text-left p-3 font-semibold text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 z-30 border-r border-gray-200 dark:border-gray-700">Car</th>
                {sortedCars.map((car) => (
                  <th key={car.id} className="text-center p-3 font-semibold text-gray-900 dark:text-white min-w-[200px] bg-white dark:bg-gray-800">
                    <div className="font-bold">{getCarDisplayName(car)}</div>
                    {car.dealership && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{car.dealership}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Vehicle Information */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-2 font-bold text-gray-900 dark:text-white">Vehicle Information</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700">Make</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.carMake || 'N/A'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700">Model</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.carModel || 'N/A'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700">Tier</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.carTier || 'N/A'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10 border-r border-gray-200 dark:border-gray-700">MSRP</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.msrp)}</td>
                ))}
              </tr>
              {sortedCars.some(car => car.vin) && (
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">VIN</td>
                  {sortedCars.map((car) => (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-mono text-xs">{car.vin || 'N/A'}</td>
                  ))}
                </tr>
              )}
              {sortedCars.some(car => car.dealership) && (
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Dealership</td>
                  {sortedCars.map((car) => (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.dealership || 'N/A'}</td>
                  ))}
                </tr>
              )}

              {/* Lease Terms */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-2 font-bold text-gray-900 dark:text-white">Lease Terms</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Lease Term (months)</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.leaseTerm}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Cap Cost %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.capCostPercent.toFixed(2)}%</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Discount</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.discount ? `-${car.discount.toFixed(1)}%` : '0%'}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Discount Amount</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.discountAmount || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Residual %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.residualPercent.toFixed(1)}%</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">APR</td>
                {sortedCars.map((car) => {
                  const apr = car.apr || (car.marketFactor ? car.marketFactor * 2400 : 0);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{apr.toFixed(2)}%</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Market Factor</td>
                {sortedCars.map((car) => {
                  const marketFactor = car.marketFactor || (car.apr ? car.apr / 2400 : 0);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{marketFactor.toFixed(6)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Sales Tax %</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.salesTaxPercent.toFixed(1)}%</td>
                ))}
              </tr>
              {sortedCars.some(car => car.ficoScore8 > 0) && (
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">FICO Score 8</td>
                  {sortedCars.map((car) => (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{car.ficoScore8 > 0 ? car.ficoScore8 : 'N/A'}</td>
                  ))}
                </tr>
              )}

              {/* Financials */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-2 font-bold text-gray-900 dark:text-white">Financials</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Base Cap Cost</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.baseCapCost)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Adjusted Cap Cost</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.adjustedCapCost)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Adjusted Cap Cost (with tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.adjustedCapCostWithTax)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Residual Value</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.residualValue)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Tag/Title/Filing Fees</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.tagTitleFilingFees || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Handling Fees</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.handlingFees || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Other Fees</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.otherFees || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Total Fees</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">{formatCurrency(payments.totalFees)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Down Payment</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.downPayment || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Equity Transfer</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.equityTransfer || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Due at Signing</td>
                {sortedCars.map((car) => (
                  <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(car.dueAtSigning || 0)}</td>
                ))}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Total Down Payment</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white font-semibold">{formatCurrency(payments.totalDownPayment)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Depreciation (Total)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.depreciation)}</td>
                  );
                })}
              </tr>

              {/* Monthly Payments */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-2 font-bold text-gray-900 dark:text-white">Monthly Payments</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Depreciation</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.monthlyDepreciation)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Finance Charge</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.monthlyFinanceCharge)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Monthly Payment (without tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(payments.baseMonthlyPayment)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                <td className="p-3 font-bold text-gray-900 dark:text-white sticky left-0 bg-blue-50 dark:bg-blue-900/20 z-10">Monthly Payment (with tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  return (
                    <td key={car.id} className="p-3 text-center font-bold text-blue-600 dark:text-blue-400">{formatCurrency(payments.totalMonthlyPayment)}</td>
                  );
                })}
              </tr>

              {/* Total Lease Cost */}
              <tr className="bg-gray-50 dark:bg-gray-900">
                <td colSpan={sortedCars.length + 1} className="p-2 font-bold text-gray-900 dark:text-white">Total Lease Cost</td>
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Total (without tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  const total = payments.baseMonthlyPayment * car.leaseTerm;
                  return (
                    <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white">{formatCurrency(total)}</td>
                  );
                })}
              </tr>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-green-50 dark:bg-green-900/20">
                <td className="p-3 font-bold text-gray-900 dark:text-white sticky left-0 bg-green-50 dark:bg-green-900/20 z-10">Total (with tax)</td>
                {sortedCars.map((car) => {
                  const payments = getCarPayments(car);
                  const total = payments.totalMonthlyPayment * car.leaseTerm;
                  return (
                    <td key={car.id} className="p-3 text-center font-bold text-green-600 dark:text-green-400">{formatCurrency(total)}</td>
                  );
                })}
              </tr>

              {/* Additional Info */}
              {sortedCars.some(car => car.notes && car.notes.trim()) && (
                <>
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <td colSpan={sortedCars.length + 1} className="p-2 font-bold text-gray-900 dark:text-white">Notes</td>
                  </tr>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <td className="p-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800 z-10">Notes</td>
                    {sortedCars.map((car) => (
                      <td key={car.id} className="p-3 text-center text-gray-900 dark:text-white text-sm whitespace-pre-wrap max-w-xs">{car.notes || 'N/A'}</td>
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

