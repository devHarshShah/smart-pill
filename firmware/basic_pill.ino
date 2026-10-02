#include "HX711.h"

#define DATA_PIN    5
#define CLK_PIN     4
#define BUZZER_PIN  18

HX711 scale;

float pillWeight   = 0;
int   totalPills   = 0;
int   currentPills = 0;
bool  setupDone    = false;

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    delay(150);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  scale.begin(DATA_PIN, CLK_PIN);
  while (!scale.is_ready()) delay(100);

  Serial.println("=== Pill Monitor ===");
  Serial.println();

  // ----------------------------------------
  // STEP 1: TARE (empty scale)
  // ----------------------------------------
  Serial.println("STEP 1: Make sure the scale is EMPTY.");
  Serial.println("Press Enter to tare...");
  waitForEnter();

  scale.tare(20);
  Serial.println("Tare done.");
  Serial.println();

  // ----------------------------------------
  // STEP 2: CALIBRATION with 1 pill
  // ----------------------------------------
  Serial.println("STEP 2: Place exactly ONE pill on the scale.");
  Serial.println("Press Enter when ready...");
  waitForEnter();

  long rawOnePill = scale.get_value(20);

  Serial.println("Type the weight of 1 pill in grams and press Enter.");
  Serial.println("(Check the pill packet — usually 100mg = 0.1g, 500mg = 0.5g)");
  Serial.println("If unknown, type 1 and we will work in 'pill units':");
  float knownPillWeight = readFloatFromSerial();

  float calibrationFactor = (float)rawOnePill / knownPillWeight;
  scale.set_scale(calibrationFactor);

  // Verify
  float measured = scale.get_units(20);
  if (measured < 0) measured = -measured;

  Serial.print("Calibration factor: ");
  Serial.println(calibrationFactor, 4);
  Serial.print("Verification reading: ");
  Serial.print(measured, 3);
  Serial.println(" g  (should match what you typed)");
  Serial.println();

  // ----------------------------------------
  // STEP 3: Record single pill weight
  // ----------------------------------------
  pillWeight = measured;
  Serial.print("1 pill = ");
  Serial.print(pillWeight, 3);
  Serial.println(" g — saved.");
  Serial.println();

  // ----------------------------------------
  // STEP 4: How many pills total?
  // ----------------------------------------
  Serial.println("STEP 3: Remove the pill. How many pills in the container?");
  Serial.println("Type the number and press Enter:");
  waitForEnter();  // let them remove the pill first
  scale.tare(10);  // re-tare with empty scale

  totalPills = (int)readFloatFromSerial();
  Serial.print("Expected total: ");
  Serial.println(totalPills);
  Serial.println();

  // ----------------------------------------
  // STEP 5: Place all pills
  // ----------------------------------------
  Serial.print("STEP 4: Place ALL ");
  Serial.print(totalPills);
  Serial.println(" pills on the scale.");
  Serial.println("Press Enter when ready...");
  waitForEnter();

  float totalWeight = scale.get_units(20);
  if (totalWeight < 0) totalWeight = -totalWeight;

  int detectedPills = (int)round(totalWeight / pillWeight);

  Serial.print("Detected: ");
  Serial.print(detectedPills);
  Serial.print(" pills  |  Expected: ");
  Serial.println(totalPills);

  if (detectedPills != totalPills) {
    Serial.println("WARNING: Count mismatch! Check pills and press Enter to continue anyway.");
    beep(5);
    waitForEnter();
  } else {
    Serial.println("All pills confirmed!");
    beep(1);
  }

  currentPills = detectedPills;
  setupDone = true;

  Serial.println();
  Serial.println("=== Monitoring started ===");
  Serial.println("Buzzer beeps when a pill is removed.");
  Serial.println();
}

void loop() {
  if (!setupDone) return;

  float weight = scale.get_units(10);
  if (weight < 0) weight = -weight;

  int newCount = (int)round(weight / pillWeight);
  if (newCount < 0) newCount = 0;
  if (newCount > totalPills) newCount = totalPills;

  if (newCount < currentPills) {
    int taken = currentPills - newCount;
    Serial.print("Pill removed! Remaining: ");
    Serial.print(newCount);
    Serial.print(" / ");
    Serial.println(totalPills);
    beep(taken);
    currentPills = newCount;
  }

  if (newCount > currentPills) {
    Serial.print("Pills added. Count: ");
    Serial.print(newCount);
    Serial.print(" / ");
    Serial.println(totalPills);
    currentPills = newCount;
  }

  if (currentPills == 0) {
    Serial.println("Container is EMPTY!");
  }

  delay(300);
}

// ----- Helpers -----
void waitForEnter() {
  while (Serial.available()) Serial.read();
  while (!Serial.available());
  while (Serial.available()) Serial.read();
}

float readFloatFromSerial() {
  while (Serial.available()) Serial.read();
  while (!Serial.available());
  delay(100);
  String input = "";
  while (Serial.available()) {
    char c = Serial.read();
    if (c >= '0' && c <= '9' || c == '.') input += c;
    delay(2);
  }
  return input.toFloat();
}