// Diagnostic process only; the tested Backend process and clock are unchanged.
public class JvmZoneProbe {
    public static void main(String[] args) {
        System.out.println(java.time.ZoneId.systemDefault().getId());
    }
}
