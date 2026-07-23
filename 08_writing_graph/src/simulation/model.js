import { createRng } from "./rng.js";
import { decileCoverage, gini, round } from "./metrics.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const active = (day, shock) => day >= shock.startDay && (shock.endDay == null || day <= shock.endDay);

export function validateSimulationConfig(config) {
  const errors = [];
  if (config.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
  if (!Number.isInteger(config.seed) || config.seed < 1) errors.push("seed must be a positive integer");
  if (!Number.isInteger(config.population) || config.population < 100 || config.population > 1000000) errors.push("population must be between 100 and 1,000,000");
  if (!Number.isInteger(config.days) || config.days < 7 || config.days > 730) errors.push("days must be between 7 and 730");
  for (const arm of ["current", "hybrid", "mind"]) if (!config.arms?.[arm]) errors.push(`missing arm ${arm}`);
  const behavior = config.behavior;
  if (!behavior) errors.push("missing behavior profile");
  else {
    if (!behavior.id) errors.push("behavior id is required");
    if (typeof behavior.priceElasticity !== "number" || behavior.priceElasticity < 0 || behavior.priceElasticity > 2) errors.push("behavior priceElasticity must be between 0 and 2");
    if (typeof behavior.spendPropensity !== "number" || behavior.spendPropensity <= 0 || behavior.spendPropensity > 1) errors.push("behavior spendPropensity must be within (0,1]");
    if (typeof behavior.shortageSubstitution !== "number" || behavior.shortageSubstitution < 0 || behavior.shortageSubstitution > 1) errors.push("behavior shortageSubstitution must be between 0 and 1");
    if (typeof behavior.sybilParticipationMultiplier !== "number" || behavior.sybilParticipationMultiplier < 0 || behavior.sybilParticipationMultiplier > 3) errors.push("behavior sybilParticipationMultiplier must be between 0 and 3");
  }
  for (const shock of ["unemployment", "shortage", "networkOutage", "sybil", "speculation", "migration", "governanceCapture"]) {
    if (!config.shocks?.[shock]) errors.push(`missing shock ${shock}`);
  }
  if (errors.length) throw new Error(`Invalid simulation config:\n- ${errors.join("\n- ")}`);
  return config;
}

export function createPopulation(config) {
  const rng = createRng(config.seed);
  const count = config.population;
  const income = new Float64Array(count);
  const need = new Float64Array(count);
  const vulnerability = new Float64Array(count);
  const group = new Uint8Array(count);
  const ordering = [];
  for (let index = 0; index < count; index += 1) {
    const healthLoad = clamp(0.25 + rng.uniform() * 0.75, 0, 1);
    vulnerability[index] = healthLoad;
    group[index] = rng.uniform() < 0.22 ? 1 : 0;
    income[index] = config.economy.dailyIncomeMean * Math.exp(rng.normal() * 0.48 - 0.12) * (group[index] ? 0.86 : 1);
    need[index] = config.economy.dailyNeedMean * clamp(0.72 + healthLoad * 0.46 + rng.normal() * 0.08, 0.55, 1.55);
    ordering.push({ index, income: income[index] });
  }
  ordering.sort((a, b) => a.income - b.income);
  const incomeRank = new Float64Array(count);
  ordering.forEach((item, rank) => { incomeRank[item.index] = rank / count; });
  return { income, need, vulnerability, group, incomeRank };
}

function shockState(day, config, armName) {
  const { shocks } = config;
  const unemploymentProgress = day < shocks.unemployment.startDay ? 0
    : clamp((day - shocks.unemployment.startDay + 1) / Math.max(1, shocks.unemployment.endDay - shocks.unemployment.startDay + 1), 0, 1);
  const supplyMultiplier = active(day, shocks.shortage) ? shocks.shortage.supplyMultiplier : 1;
  const networkMultiplier = active(day, shocks.networkOutage)
    ? (armName === "mind" ? config.arms.mind.offlineContinuity : 1) * shocks.networkOutage.serviceMultiplier : 1;
  return {
    employmentRate: clamp(0.92 - unemploymentProgress * shocks.unemployment.additionalRate, 0.35, 1),
    supplyMultiplier,
    networkMultiplier,
    sybilShare: armName === "mind" && active(day, shocks.sybil)
      ? clamp(shocks.sybil.fakeIdentityShare * config.behavior.sybilParticipationMultiplier, 0, 0.95) : 0,
    liquidityDrain: armName === "mind" && active(day, shocks.speculation) ? shocks.speculation.liquidityDrainRate : 0,
    demandMultiplier: active(day, shocks.migration) ? shocks.migration.demandMultiplier : 1,
    fairnessLoss: armName === "mind" && active(day, shocks.governanceCapture) ? shocks.governanceCapture.fairnessLoss : 0
  };
}

function runArm(config, population, armName, includeCaseDiagnostics = false) {
  const arm = config.arms[armName];
  const count = config.population;
  const wallet = new Float64Array(count);
  const needTotals = new Float64Array(count);
  const servedTotals = new Float64Array(count);
  const merchantCash = new Float64Array(config.economy.merchantCount);
  const merchantCapacity = new Float64Array(config.economy.merchantCount);
  const initialBuffer = config.economy.initialHouseholdBufferDays * config.economy.dailyNeedMean;
  for (let index = 0; index < count; index += 1) wallet[index] = initialBuffer * (0.35 + population.incomeRank[index] * 1.3);
  for (let index = 0; index < merchantCash.length; index += 1) {
    merchantCapacity[index] = config.economy.supplyPerPerson * count / merchantCash.length * (0.75 + (index % 11) / 20);
    merchantCash[index] = merchantCapacity[index] * config.economy.initialMerchantBufferDays * (config.economy.unitPrice - config.economy.unitCost);
  }

  let totalNeed = 0;
  let totalServed = 0;
  let priceGroup0 = 0;
  let priceGroup1 = 0;
  let group0Days = 0;
  let group1Days = 0;
  let stockoutDays = 0;
  let sybilCaptured = 0;
  const daily = [];

  for (let day = 0; day < config.days; day += 1) {
    const shock = shockState(day, config, armName);
    let potentialDemand = 0;
    let dayNeed = 0;
    const affordable = new Float64Array(count);
    const prices = new Float64Array(count);
    const effectiveTransfer = arm.dailyTransfer * (1 - shock.sybilShare);
    sybilCaptured += arm.dailyTransfer * shock.sybilShare * count;

    for (let index = 0; index < count; index += 1) {
      wallet[index] *= 1 - arm.demurrageRate;
      const labor = population.income[index] * shock.employmentRate;
      wallet[index] += labor + effectiveTransfer;
      const cap = arm.walletCapDays * population.need[index] * config.economy.unitPrice;
      wallet[index] = Math.min(wallet[index], cap);
      if (shock.liquidityDrain) wallet[index] *= 1 - shock.liquidityDrain;

      const contextualDiscount = arm.contextualPricing * (population.vulnerability[index] - 0.5) * (1 - shock.fairnessLoss);
      const capturedBias = shock.fairnessLoss * arm.contextualPricing * population.group[index] * 0.5;
      const price = config.economy.unitPrice * clamp(1 - contextualDiscount + capturedBias, 0.55, 1.6);
      prices[index] = price;
      const requested = population.need[index] * shock.demandMultiplier;
      const priceResponse = Math.min(1, Math.pow(config.economy.unitPrice / price, config.behavior.priceElasticity));
      const behavioralDemand = requested * priceResponse;
      const spendable = wallet[index] * config.behavior.spendPropensity;
      affordable[index] = Math.min(behavioralDemand, spendable / price) * shock.networkMultiplier;
      potentialDemand += affordable[index];
      dayNeed += requested;
      if (population.group[index]) { priceGroup1 += price; group1Days += 1; }
      else { priceGroup0 += price; group0Days += 1; }
    }

    const substitutionRecovery = (1 - shock.supplyMultiplier) * config.behavior.shortageSubstitution;
    const behavioralSupplyMultiplier = clamp(shock.supplyMultiplier + substitutionRecovery, 0, 1);
    const totalCapacity = merchantCapacity.reduce((sum, value) => sum + value, 0) * behavioralSupplyMultiplier;
    const ration = potentialDemand ? Math.min(1, totalCapacity / potentialDemand) : 1;
    if (ration < 0.99) stockoutDays += 1;
    let dayServed = 0;
    let revenue = 0;
    for (let index = 0; index < count; index += 1) {
      const served = affordable[index] * ration;
      const requested = population.need[index] * shock.demandMultiplier;
      const cost = served * prices[index];
      wallet[index] = Math.max(0, wallet[index] - cost);
      needTotals[index] += requested;
      servedTotals[index] += served;
      dayServed += served;
      revenue += cost;
    }
    const produced = Math.min(totalCapacity, dayServed);
    for (let index = 0; index < merchantCash.length; index += 1) {
      const share = merchantCapacity[index] / (totalCapacity / behavioralSupplyMultiplier || 1);
      merchantCash[index] += revenue * share - produced * config.economy.unitCost * share;
    }
    totalNeed += dayNeed;
    totalServed += dayServed;
    daily.push({ day, coverageRate: round(dayServed / dayNeed), rationFactor: round(ration), employmentRate: round(shock.employmentRate), supplyMultiplier: shock.supplyMultiplier });
  }

  const purchasingCapacity = Array.from(wallet, (value, index) => value + population.income[index]);
  const merchantSurvival = [...merchantCash].filter(value => value >= 0).length / merchantCash.length;
  const group0Price = priceGroup0 / group0Days;
  const group1Price = priceGroup1 / group1Days;
  const excluded = servedTotals.reduce((sum, served, index) => sum + (served / needTotals[index] < 0.8 ? 1 : 0), 0);
  const result = {
    arm: armName,
    metrics: {
      coverageRate: round(totalServed / totalNeed),
      unmetNeedPersonDays: round((totalNeed - totalServed) / config.economy.dailyNeedMean, 2),
      coverageByIncomeDecile: decileCoverage(needTotals, servedTotals, population.incomeRank),
      purchasingCapacityGini: round(gini(purchasingCapacity)),
      merchantSurvivalRate: round(merchantSurvival),
      stockoutDays,
      exclusionRate: round(excluded / count),
      protectedGroupPriceGapPct: round((group1Price - group0Price) / group0Price * 100, 2),
      sybilCapturedUnits: round(sybilCaptured, 2),
      dataFieldsRequired: arm.dataFieldsRequired,
      governanceConcentration: arm.governanceConcentration
    },
    daily
  };
  if (includeCaseDiagnostics) {
    const coverageRates = Array.from(servedTotals, (served, index) => round(needTotals[index] ? served / needTotals[index] : 1, 6));
    result.caseDiagnostics = {
      unit: "coverage_rate_per_synthetic_person",
      exclusionThreshold: 0.8,
      coverageRates,
      faults: coverageRates.map(value => value < 0.8)
    };
  }
  return result;
}

export function runSimulation(inputConfig, options = {}) {
  const config = validateSimulationConfig(structuredClone(inputConfig));
  const population = createPopulation(config);
  const arms = ["current", "hybrid", "mind"].map(name => runArm(config, population, name, options.includeCaseDiagnostics === true));
  return {
    metadata: {
      modelVersion: "0.1.0-p1",
      schemaVersion: config.schemaVersion,
      generatedAt: new Date().toISOString(),
      status: "exploratory_model_output_not_empirical_evidence",
      seed: config.seed,
      population: config.population,
      days: config.days,
      comparableArms: true,
      behaviorProfile: config.behavior.id,
      decisionThresholds: config.decisionThresholds,
      warnings: [
        "Parameters are working assumptions, not calibrated empirical estimates.",
        "Differences between arms describe this model, not real-world causal effects.",
        "Decision thresholds are intentionally unset until the variance pilot."
      ]
    },
    config,
    arms
  };
}
